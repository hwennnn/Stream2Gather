package source

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"stream2gather/internal/room"
	"stream2gather/internal/store"
)

const (
	// YouTube requires stored API data to be refreshed within 30 days.
	mediaMaxAge    = 25 * 24 * time.Hour
	searchMaxAge   = 7 * 24 * time.Hour
	trendingMaxAge = time.Hour
	searchBucket   = "youtube:search"
	// LookupsPerHour is what one address can spend on links nobody has seen. It
	// has to outlast a party behind one address, and leave most of a day's budget.
	LookupsPerHour = 120
)

// Charge asks whoever wants a lookup to pay for it. Lookups the cache answers are free.
type Charge func(context.Context) error

// LookupCharge charges an address, through a fixed-window limiter.
func LookupCharge(limit func(context.Context, string, int64, time.Duration) (bool, error), address string) Charge {
	return func(ctx context.Context) error {
		allowed, err := limit(ctx, "lookups:"+address, LookupsPerHour, time.Hour)
		if err != nil {
			return err
		}
		if !allowed {
			return ErrTooManyLinks
		}
		return nil
	}
}

var viewerRegion = regexp.MustCompile(`^[A-Z]{2}$`)

// Catalog resolves links and searches through caches and the quota budget.
type Catalog struct {
	sources []Source
	db      *store.Postgres
	budget  int
	log     *slog.Logger
	// LookupBudget caps lookups a day, so nothing can spend the quota that search
	// and metadata renewal also need. Zero means no cap.
	LookupBudget int
}

// NewCatalog returns a catalog over sources, tried in order.
func NewCatalog(db *store.Postgres, budget int, log *slog.Logger, sources ...Source) *Catalog {
	return &Catalog{sources: sources, db: db, budget: budget, log: log}
}

// Names lists the enabled sources.
func (c *Catalog) Names() []string {
	names := make([]string, len(c.sources))
	for i, s := range c.sources {
		names[i] = s.Name()
	}
	return names
}

// spend pays for one call to a metered source. charge may be nil.
func (c *Catalog) spend(ctx context.Context, s Source, charge Charge) error {
	if _, metered := s.(Metered); !metered {
		return nil
	}
	if charge != nil {
		if err := charge(ctx); err != nil {
			return err
		}
	}
	if c.LookupBudget == 0 {
		return nil
	}
	reserved, err := c.db.ReserveQuota(ctx, s.Name()+":lookup", c.LookupBudget)
	if err != nil {
		return err
	}
	if !reserved {
		return ErrLinksResting
	}
	return nil
}

// Resolve turns a pasted link into media. charge pays if the source has to be
// asked, and a dead link is never cached, so it pays every time.
func (c *Catalog) Resolve(ctx context.Context, raw string, charge Charge) (room.Media, error) {
	link, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || link.Host == "" {
		return room.Media{}, ErrUnsupportedURL
	}

	for _, s := range c.sources {
		ref, ok := s.Match(link)
		if !ok {
			continue
		}
		cached, found, err := c.db.GetMedia(ctx, ref.Source, ref.ID, mediaMaxAge)
		if err != nil {
			return room.Media{}, err
		}
		// A cached live flag can be stale: the stream may have finished.
		if found && !cached.IsLive {
			return cached, nil
		}

		if err := c.spend(ctx, s, charge); err != nil {
			return room.Media{}, err
		}
		media, err := s.Resolve(ctx, ref)
		if err != nil {
			return room.Media{}, err
		}
		if err := c.db.PutMedia(ctx, []room.Media{media}); err != nil {
			return room.Media{}, err
		}
		return media, nil
	}
	return room.Media{}, ErrUnsupportedURL
}

func (c *Catalog) source(name string) (Source, error) {
	for _, s := range c.sources {
		if s.Name() == name {
			return s, nil
		}
	}
	return nil, fmt.Errorf("unknown source %q", name)
}

// Search returns cached results when it can, and spends budget when it must.
func (c *Catalog) Search(ctx context.Context, sourceName, query, region string) ([]room.Media, error) {
	s, err := c.source(sourceName)
	if err != nil {
		return nil, err
	}
	normalized := strings.Join(strings.Fields(strings.ToLower(query)), " ")
	if normalized == "" {
		return []room.Media{}, nil
	}

	cached, found, err := c.db.CachedSearch(ctx, sourceName, normalized, region, searchMaxAge)
	if err != nil {
		return nil, err
	}
	if found {
		return cached, nil
	}

	reserved, err := c.db.ReserveQuota(ctx, searchBucket, c.budget)
	if err != nil {
		return nil, err
	}
	if !reserved {
		return nil, ErrOverBudget
	}

	items, err := s.Search(ctx, query, region)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		// Nothing found costs the same quota as a full page, so it is kept too.
		if err := c.db.PutSearch(ctx, sourceName, normalized, region, []string{}); err != nil {
			c.log.Warn("search cache write failed", "error", err)
		}
		return []room.Media{}, nil
	}
	return c.remember(ctx, sourceName, normalized, region, items)
}

// Trending is cached for an hour, under a query name no user search can produce.
func (c *Catalog) Trending(ctx context.Context, sourceName string) ([]room.Media, error) {
	s, err := c.source(sourceName)
	if err != nil {
		return nil, err
	}
	const key, region = "\x01trending", ""

	cached, found, err := c.db.CachedSearch(ctx, sourceName, key, region, trendingMaxAge)
	if err != nil {
		return nil, err
	}
	if found {
		return cached, nil
	}

	if err := c.spend(ctx, s, nil); err != nil {
		return nil, err
	}
	items, err := s.Trending(ctx)
	if err != nil {
		return nil, err
	}
	return c.remember(ctx, sourceName, key, region, items)
}

// remember stores results and leaves out live streams, which cannot be played.
// Videos viewers saw refused stay findable, marked and below the rest.
func (c *Catalog) remember(ctx context.Context, sourceName, query, region string, items []room.Media) ([]room.Media, error) {
	if len(items) == 0 {
		return items, nil
	}
	if err := c.db.PutMedia(ctx, items); err != nil {
		return nil, err
	}
	ids := make([]string, len(items))
	for i, item := range items {
		ids[i] = item.SourceID
	}
	if err := c.db.PutSearch(ctx, sourceName, query, region, ids); err != nil {
		c.log.Warn("search cache write failed", "error", err)
	}

	blocked, err := c.db.EmbedBlocked(ctx, sourceName, ids)
	if err != nil {
		return nil, err
	}
	kept := items[:0]
	for _, item := range items {
		if !item.IsLive {
			item.Refused = blocked[item.SourceID]
			kept = append(kept, item)
		}
	}
	sinkTroubled(kept)
	return kept, nil
}

func sinkTroubled(items []room.Media) {
	rank := func(m room.Media) int {
		switch {
		case m.Refused:
			return 2
		case m.RegionBlocked:
			return 1
		}
		return 0
	}
	slices.SortStableFunc(items, func(a, b room.Media) int { return rank(a) - rank(b) })
}

// ForViewer marks and sinks what the owner keeps from the viewer's region, which
// is a two-letter code or unknown. Results are cached for everyone, so this runs
// per request and never costs a search.
func ForViewer(items []room.Media, region string) []room.Media {
	if !viewerRegion.MatchString(region) {
		return items
	}
	for i := range items {
		allowed, blocked := strings.Fields(items[i].AllowedRegions), strings.Fields(items[i].BlockedRegions)
		items[i].RegionBlocked = slices.Contains(blocked, region) || (len(allowed) > 0 && !slices.Contains(allowed, region))
	}
	sinkTroubled(items)
	return items
}

// RefreshStale renews metadata nearing YouTube's 30-day limit, and deletes what
// can no longer be fetched, as the API terms require. It returns both counts.
func (c *Catalog) RefreshStale(ctx context.Context, limit int) (refreshed, deleted int, err error) {
	for _, s := range c.sources {
		batcher, ok := s.(Batcher)
		if !ok {
			continue
		}
		ids, err := c.db.StaleMedia(ctx, s.Name(), mediaMaxAge, limit)
		if err != nil {
			return refreshed, deleted, err
		}
		if len(ids) == 0 {
			continue
		}

		fresh, err := batcher.ResolveMany(ctx, ids)
		if err != nil {
			return refreshed, deleted, err
		}
		if len(fresh) > 0 {
			if err := c.db.PutMedia(ctx, fresh); err != nil {
				return refreshed, deleted, err
			}
		}

		found := make(map[string]bool, len(fresh))
		for _, media := range fresh {
			found[media.SourceID] = true
		}
		gone := make([]string, 0, len(ids))
		for _, id := range ids {
			if !found[id] {
				gone = append(gone, id)
			}
		}
		if err := c.db.DeleteMedia(ctx, s.Name(), gone); err != nil {
			return refreshed, deleted, err
		}
		refreshed += len(fresh)
		deleted += len(gone)
	}
	return refreshed, deleted, nil
}

// StaleBacklog counts metadata past the refresh age that no run has reached. Above
// zero, RefreshStale is falling behind and the 30-day limit is getting closer.
func (c *Catalog) StaleBacklog(ctx context.Context) (int64, error) {
	var total int64
	for _, s := range c.sources {
		if _, ok := s.(Batcher); !ok {
			continue
		}
		count, err := c.db.CountStaleMedia(ctx, s.Name(), mediaMaxAge)
		if err != nil {
			return total, err
		}
		total += count
	}
	return total, nil
}

// PurgeSearches removes cached results too old for any search to use.
func (c *Catalog) PurgeSearches(ctx context.Context) (int64, error) {
	return c.db.PurgeSearches(ctx, searchMaxAge)
}

// IsUserError reports whether an error's text is safe and useful to show.
func IsUserError(err error) bool {
	return errors.Is(err, ErrUnsupportedURL) || errors.Is(err, ErrUnavailable) || errors.Is(err, ErrNoEmbed) ||
		errors.Is(err, ErrOverBudget) || errors.Is(err, ErrNoSearch) || errors.Is(err, ErrLive) ||
		errors.Is(err, ErrTooManyLinks) || errors.Is(err, ErrLinksResting)
}
