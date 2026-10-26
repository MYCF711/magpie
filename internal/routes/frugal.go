package routes

// FrugalFirst is a routing that is wholly additive: it lives in this file
// alone, registers itself under RouteID, and changes nothing upstream. That
// is on purpose — a patch that only adds never conflicts when magpie
// updates itself, so the "official version + our patch" build can be made
// from any release without touching a line of it.
//
// It spends what is lost soonest before what is never lost, in four tiers:
//
//	1. free      — its vendor serves this model at no cost to the
//	               subscription's allowance or credits (Seat.Free, which the
//	               gateway fills because ByFree is set below)
//	2. expiring  — what it holds runs out at a known moment: the window
//	               that renews first, or whose credits run out before that
//	               (Allowance.Renewal folds the two into one moment)
//	3. endless   — nothing it holds ever runs out: no window at all, or one
//	               that never renews
//	4. unknown   — its allowance isn't known; kept after those known, as
//	               Smart keeps them
//
// Free comes first because a free seat spends nothing by running out of, so
// running low is no reason to push it behind one that spends. Endless comes
// last because spending it costs something still there tomorrow: a plan
// that never resets, a key magpie doesn't read windows for. Within a tier
// the moment decides; those alike to the hour keep their listed order, so a
// few minutes don't reorder and the vendor's prompt cache stays warm.
//
// Unlike Smart it goes by the moment for every window that counts the
// model, not the week alone: a daily allowance with an hour left goes
// before a weekly one with two, whichever the vendor calls it.

import (
	"sort"
	"time"

	"github.com/yetone/magpie/internal/provider"
)

// RouteID is the routing's id, as providers.json and groups save it. The
// "<plugin>/<name>" form is deliberate: provider.PluginRouting accepts it
// on its own, so saving it never needs a line added to the whitelists in
// provider.go and group.go — which is what keeps this patch additive.
// CLI and TUI accept it for the same reason (routingMatches).
const RouteID = "frugal/expiring"

// FrugalFirst is the strategy. ByFree is what has the gateway fill Seat.Free
// for it; without it that field is never worked out, and the first tier
// would be empty for everyone.
var FrugalFirst = Strategy{ByFree: true, Order: func(_ string, seats []Seat) []int {
	free := make([]int, 0, len(seats))
	paid := make([]int, 0, len(seats))
	endless := make([]int, 0, len(seats))
	unknown := make([]int, 0, len(seats))

	for i, s := range seats {
		switch {
		case s.Free:
			free = append(free, i)
		case !s.Known:
			unknown = append(unknown, i)
		case len(s.Soon) == 0 || s.Soon[0].IsZero():
			endless = append(endless, i)
		default:
			paid = append(paid, i)
		}
	}

	// Soon[0] is the first moment something is lost, in whole hours so a few
	// minutes don't reorder — the same reading Smart takes of a renewal.
	sort.SliceStable(paid, func(a, b int) bool {
		x := seats[paid[a]].Soon[0].Truncate(time.Hour)
		y := seats[paid[b]].Soon[0].Truncate(time.Hour)
		return x.Before(y)
	})

	out := make([]int, 0, len(seats))
	out = append(out, free...)
	out = append(out, paid...)
	out = append(out, endless...)
	out = append(out, unknown...)
	return out
}}

// init registers the routing where plugins/rotation registers magpie's own,
// so it is served exactly while that plugin is on: the pickers offer it, and
// a provider or group already set to it routes by it again after a restart.
// Nothing upstream is edited to make this happen — routes.Register only
// needs the name, not an entry in Builtin.
func init() {
	Register(RouteID, FrugalFirst)
}

// FrugalName is the routing's display name. Kept here rather than in
// i18n.js, since the id is what the pickers show for a plugin routing.
const FrugalName = "勤俭持家"

// FrugalSummary is what the routing does, in one paragraph, for a caller
// that wants to explain it (the CLI again after a later change).
const FrugalSummary = "先花不花钱的，再花最快到期的，最后才动永不过期的。"

// FrugalRoutings is every id this file serves, for a caller listing them.
var FrugalRoutings = []string{RouteID}

// FrugalIsRoutingName reports whether name is this file's routing, by its
// full id or by the bare word a person would type.
func FrugalIsRoutingName(name string) bool {
	return name == RouteID || name == "expiring"
}

// Keep the provider import used whether or not a later edit needs it, so a
// patch that only adds never fails to compile on its own.
var _ = provider.Ordered
