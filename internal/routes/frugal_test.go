package routes

import (
	"regexp"
	"slices"
	"testing"
	"time"
)

// hours is the moment seats renew at, in whole hours from a fixed base, so a
// test's readings are alike to the hour as routing takes them.
func hours(n int) []time.Time {
	return []time.Time{time.UnixMilli(1700000000000).Add(time.Duration(n) * time.Hour)}
}

// FrugalFirst spends what is lost soonest before what is never lost: a free
// seat first of all, then the seats whose allowance runs out soonest, then
// the ones that never run out, and a seat whose allowance isn't known after
// those known of its tier.
func TestFrugalFirstSpendsWhatIsLostSoonest(t *testing.T) {
	cases := []struct {
		name  string
		seats []Seat
		want  []int
	}{
		{
			// the point of the tier: a free seat outranks a paid one however
			// much either has left, since a free one spends nothing by
			// running out
			name: "free before any that spends",
			seats: []Seat{
				{Key: "paid-soon", Known: true, Used: 10, Soon: hours(1)},
				{Key: "free", Free: true, Known: true, Used: 99, Soon: hours(0)},
			},
			want: []int{1, 0},
		},
		{
			// what is lost at 1h goes before 5h, which goes before 48h, even
			// when the later one has far more left
			name: "by the moment it is lost",
			seats: []Seat{
				{Key: "week", Known: true, Used: 5, Soon: hours(48)},
				{Key: "day", Known: true, Used: 90, Soon: hours(1)},
				{Key: "five", Known: true, Used: 40, Soon: hours(5)},
			},
			want: []int{1, 2, 0},
		},
		{
			// never lost: no window at all, or one that never renews, both
			// after what does expire
			name: "what never runs out goes last",
			seats: []Seat{
				{Key: "endless", Known: true, Used: 0},
				{Key: "expiring", Known: true, Used: 80, Soon: hours(2)},
				{Key: "zero-time", Known: true, Used: 1, Soon: []time.Time{{}}},
			},
			want: []int{1, 0, 2},
		},
		{
			// an unknown allowance may be lost at any moment, but nothing
			// says so: it goes after those known, as Smart puts it
			name: "unknown after known",
			seats: []Seat{
				{Key: "unknown", Known: false, Used: 0},
				{Key: "known", Known: true, Used: 95, Soon: hours(3)},
			},
			want: []int{1, 0},
		},
		{
			// nothing free and nothing expiring: In order, so a pool like
			// this routes as it always did
			name:  "none free and none expiring",
			seats: []Seat{{Key: "a", Known: true}, {Key: "b", Known: true}},
			want:  []int{0, 1},
		},
		{
			// the four tiers at once, each keeping its listed order
			name: "free, then expiring, then endless, then unknown",
			seats: []Seat{
				{Key: "endless", Known: true, Used: 0},
				{Key: "paid-week", Known: true, Used: 10, Soon: hours(40)},
				{Key: "free", Free: true, Known: true, Used: 100},
				{Key: "unknown", Known: false},
				{Key: "paid-hour", Known: true, Used: 70, Soon: hours(1)},
			},
			want: []int{2, 4, 1, 0, 3},
		},
		{
			// a few minutes apart are not a different moment: routing takes
			// them to the hour, so the listed order stands (the vendor's
			// prompt cache included). The later one is listed first here, so
			// reading the minutes alone would swap them.
			name: "alike to the hour keep their order",
			seats: []Seat{
				{Key: "first", Known: true, Used: 50, Soon: []time.Time{time.UnixMilli(1700000000000).Add(65 * time.Minute)}},
				{Key: "second", Known: true, Used: 50, Soon: []time.Time{time.UnixMilli(1700000000000).Add(63 * time.Minute)}},
			},
			want: []int{0, 1},
		},
		{
			// an hour apart on the clock is not the same moment
			name: "an hour apart is not the same moment",
			seats: []Seat{
				{Key: "eleven", Known: true, Used: 50, Soon: []time.Time{time.Date(2026, 10, 26, 11, 1, 0, 0, time.UTC)}},
				{Key: "ten", Known: true, Used: 50, Soon: []time.Time{time.Date(2026, 10, 26, 10, 59, 0, 0, time.UTC)}},
			},
			want: []int{1, 0},
		},
		{
			// the first window decides: the biggest one is what is lost at
			// the reset Smart weighs, and so is the loss here
			name: "the first window decides",
			seats: []Seat{
				{Key: "late", Known: true, Used: 1, Soon: []time.Time{time.UnixMilli(1700000000000).Add(50 * time.Hour), time.UnixMilli(1700000000000).Add(time.Hour)}},
				{Key: "early", Known: true, Used: 1, Soon: hours(3)},
			},
			want: []int{1, 0},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Apply(FrugalFirst, "group/g", c.seats); !slices.Equal(got, c.want) {
				t.Fatalf("order = %v, want %v", got, c.want)
			}
		})
	}
}

// FrugalFirst asks the gateway for Free (Strategy.ByFree), since nothing
// else fills it: without it the first tier is empty for every pool.
func TestFrugalFirstIsByFree(t *testing.T) {
	if !FrugalFirst.ByFree {
		t.Fatal("FrugalFirst doesn't ask the gateway for Free")
	}
}

// The routing is served under RouteID, so a provider or group saved with it
// routes by it: routes.Find must know the id.
func TestFrugalIsServedUnderItsID(t *testing.T) {
	s, ok := Find(RouteID)
	if !ok {
		t.Fatalf("%q is not served", RouteID)
	}
	if s.Order == nil {
		t.Fatalf("%q has no order", RouteID)
	}
}

// The id is one provider.PluginRouting accepts, which is what lets it be
// saved without touching the whitelists in provider.go and group.go — the
// whole reason this patch stays additive.
func TestFrugalIDNeedsNoWhitelist(t *testing.T) {
	if !FrugalIsRoutingName(RouteID) {
		t.Fatalf("%q is not one of this file's routings", RouteID)
	}
	// provider.PluginRouting is the check providers.json is held to; this
	// package cannot import provider (it would be a cycle), so the rule is
	// stated here as the same shape it holds.
	if !regexp.MustCompile(`^[A-Za-z0-9._-]+/[A-Za-z0-9][A-Za-z0-9._-]*$`).MatchString(RouteID) {
		t.Fatalf("%q would be refused when saved", RouteID)
	}
}
