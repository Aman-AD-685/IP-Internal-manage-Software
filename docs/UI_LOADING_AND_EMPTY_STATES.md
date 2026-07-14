# UI loading (skeleton) & empty states — technical guide

**Priority:** Medium · **Area:** UI / Design  
**Stack:** React 18 + Ant Design 5 + existing `skeletons.tsx` toolkit  
**Related:** [INDUSTRIAL_UI_DESIGN_SPEC.md](INDUSTRIAL_UI_DESIGN_SPEC.md) § page templates, empty/loading

---

## 1. Problem statement

| Issue | Current | User impact |
|-------|---------|-------------|
| **Skeleton loading** | Mix of Ant `Spin`, centered spinners, and skeleton overlays | Layout jumps when data arrives; pages feel slower than they are |
| **Empty states** | Default Table “No data” on most list pages | New users and filtered-empty cases get no explanation or next step |

**Goal:** Perceived load time ~30–40% faster (same network time) via layout-stable skeletons; every major list distinguishes **no records yet** vs **filter returned nothing** with a clear CTA.

---

## 2. Skeleton loading — architecture

### 2.1 Design principle

> Show **placeholder shapes that match the final layout** (cards, table rows, chart blocks)—not a generic spinner in the center of a blank page.

Ant Design `Skeleton` is the only primitive. Shared wrappers live in:

`fms-frontend/src/components/common/skeletons.tsx`

| Export | Use when |
|--------|----------|
| `PageSkeleton` | Route lazy-load (`Suspense`), auth bootstrap |
| `DashboardBlockSkeleton` | KPI tiles + table block (Dashboard KPI, DbDash) |
| `TableWithSkeletonLoading` | Any Ant `Table` first load — set `loading={false}` on Table |
| `SkeletonOverlay` | Section refresh over existing shell (Support Dashboard, Settings) |
| `ChartAreaSkeleton` | Lazy Recharts chunks |
| `ModalContentSkeleton` | Drawer/modal body first paint |
| `DetailPageSkeleton` | Lead detail, ticket-style detail pages |
| `TableLoadMoreSkeleton` | Infinite scroll / load-more footer |
| `SoumyaDashboardSkeleton` | Soumya KPI dashboard |
| `KpiTeamRowSkeleton` | Admin KPI user cards (defined, wire on Dashboard) |
| `SuccessCardsRowSkeleton` | Payment KPI card row (defined, wire on PaymentAmountKpiCards) |

**Do not use:** Ant `Table loading={true}` with default spinner (causes column overlap / small centered indicator).  
**Do not use:** `LoadingSpinner` name for new code — it renders skeletons; prefer explicit skeleton imports.

### 2.2 Dashboard bootstrap (keep + extend)

Existing fast path (do not regress):

```
login → sessionApiCacheGetStale('dashboard:summary') → instant paint if hit
     → miss: DashboardSkeleton → getSummary() → lazy chunks (OperationsOverview, MyWork, KpiOverview)
warmupAfterLogin / routePrefetch → summary prefetch ~200ms after login
```

**Gap:** Sub-widgets still use `<Spin />` (`KpiOverview`, `PaymentAmountKpiCards`, KPI Support FMS tiles). Replace with shape-matched skeletons and reserve `minHeight`.

### 2.3 Implementation rules

1. **Reserve height** — every loading region sets `minHeight` (table area ≥280px, charts ≥280px, Support overlay 480px).
2. **One pattern per surface** — tables → `TableWithSkeletonLoading`; cards → row skeleton; modals → `ModalContentSkeleton`.
3. **`aria-busy="true"`** — already on `SkeletonOverlay`; add to full-page skeleton wrappers.
4. **No double loading** — if parent shows skeleton, child must not also spin.
5. **Cache-first unchanged** — skeleton only when `loading && !cachedData`.

### 2.4 Rollout priority (P0 → P2)

| Priority | File | Change |
|----------|------|--------|
| P0 | `KpiOverview.tsx` | Replace `<Spin />` with 2-ring/card skeleton + minHeight |
| P0 | `PaymentAmountKpiCards.tsx` | Use `SuccessCardsRowSkeleton` |
| P0 | `TicketDetail.tsx` | `DetailPageSkeleton` instead of `PageSkeleton` |
| P1 | `DashboardKPIPage.tsx` | Replace Support FMS `<Spin tip=…>` with tile skeletons |
| P1 | `OperationsOverview.tsx` | Modal tables → `TableWithSkeletonLoading` |
| P1 | Drawers (`TicketDetailDrawer`, etc.) | `ModalContentSkeleton` |
| P2 | `UserList.tsx` load-more | `TableLoadMoreSkeleton` |
| P2 | `SystemControlSettings.tsx` | `SkeletonOverlay` vs `Card loading` |
| P2 | `SolutionList.tsx` | Single `TableWithSkeletonLoading` path |

### 2.5 CSS / theme

- Overlay background: `--skeleton-overlay-bg` in `dashboard-kpi.css`
- Match industrial tokens: `#F5F7FB` page, `#FFFFFF` card, 12px radius
- Skeleton animation: Ant default `active` (no custom deps)

### 2.6 Test plan (skeleton)

1. Hard refresh Dashboard — no full-page white flash; skeleton → tiles without vertical jump.
2. Throttle network (Slow 3G) — table pages show row-shaped placeholders, not center spinner.
3. Repeat visit with session cache — cached data paints immediately, no skeleton flash.
4. Lighthouse CLS — target no regression on Dashboard, TicketList, DashboardKPI after changes.

---

## 3. Empty states — architecture

### 3.1 Design principle

> Every empty list answers: **why is it empty?** and **what should I do next?**

Two cases everywhere:

| Case | Copy pattern | CTA examples |
|------|--------------|--------------|
| **Truly empty** | “No open tickets yet.” | Create Ticket, Add Task, Add Lead |
| **Filter-empty** | “No tickets match this filter.” | Clear filters, Widen date range |

Use Ant `Empty` with `description`, optional `image={Empty.PRESENTED_IMAGE_SIMPLE}`, and `children` for primary `Button`.

### 3.2 Shared component (to add)

**Path (planned):** `fms-frontend/src/components/common/SectionEmptyState.tsx`

```tsx
type SectionEmptyStateProps = {
  variant: 'no-data' | 'no-filter-results' | 'no-permission'
  title: string
  description?: string
  primaryAction?: { label: string; onClick: () => void }
  secondaryAction?: { label: string; onClick: () => void }
}
```

**Table integration:**

```tsx
<Table
  locale={{
    emptyText: (
      <SectionEmptyState
        variant={hasActiveFilters ? 'no-filter-results' : 'no-data'}
        title={...}
        primaryAction={...}
      />
    ),
  }}
/>
```

Reference implementations already in repo:

- `PerformanceMonitoringPage.tsx` — filter-aware `emptyText` + Add POC
- `ClientTrainingPage.tsx` — workflow CTA in emptyText
- `TicketList.tsx` — section-specific copy (extend for filters)

### 3.3 Per-section spec

| Section | Truly empty | Filter-empty | Primary CTA |
|---------|-------------|--------------|-------------|
| **Support / Tickets** | No tickets in this section | No matches for search/filters | Submit Support Ticket (header); Clear filters |
| **Checklist** | No tasks for Today | No tasks for selected filter | Add Task |
| **Delegation** | No delegation tasks | Ref/date filter cleared all rows | Add Task |
| **Leads** | No open leads | Company/stage/ref filters | Add Lead Details |
| **Staging** | No staging records | Client filter | (navigate to Support) |
| **Users** | No users (admin) | Search no match | Adjust search |
| **Solutions** | No solutions for ticket | — | Propose solution |
| **Performance Monitoring** | No active companies | NA filter empty | Add POC Details ✓ (exists) |
| **Client Training** | No clients | — | Onboarding path ✓ (exists) |
| **Dashboard KPI** | Not assigned / no data | Week filter empty | Open KPI / pick week ✓ (partial) |
| **Db Dash** | No records from API | Org/company filter | Link to onboarding |

### 3.4 Visual spec (industrial UI)

- Center inside **card/table body**, not full viewport (except permission-denied full page).
- Icon: Ant `Empty.PRESENTED_IMAGE_SIMPLE` or custom SVG ≤120px (no external CDN).
- Title: 15–16px semibold `#0F172A`
- Description: 13–14px `#64748B`, max 2 lines
- Primary button: accent `#F59E0B` or primary `#2563EB` per page convention
- Secondary: `type="link"` — “Clear filters”

### 3.5 Rollout priority

| Phase | Scope |
|-------|--------|
| **Phase 1** | **Done** — `SectionEmptyState`; TicketList, Checklist, Delegation, LeadList |
| **Phase 2** | Staging, Users, Solutions, CompPerform, DbDash filter-empty |
| **Phase 3** | Dashboard panels (KpiOverview, OperationsOverview CTAs); KPI page consistency |

### 3.6 Test plan (empty)

1. New user with zero tickets — sees explanation + create path (not “No data”).
2. Apply filter that excludes all rows — different copy + Clear filters.
3. Clear filters — table repopulates; empty state not shown.
4. Mobile — empty block readable, CTA tappable (44px min touch).

---

## 4. Non-goals

- Backend API changes for empty detection
- New illustration library / Lottie
- Skeleton for auth form submit buttons (keep button `loading` only)
- Replacing every `Spin` in modals under 200ms loads (use judgment)

---

## 5. Success metrics

| Metric | Target |
|--------|--------|
| Table pages on default Ant empty | 0 after Phase 2 |
| Table pages on Spin-only first load | 0 after P1 skeleton rollout |
| CLS (Dashboard, Tickets) | No increase vs baseline |
| Support tickets on filter-empty | User can clear filters in one tap |

---

## 6. File index

| Path | Role |
|------|------|
| `fms-frontend/src/components/common/skeletons.tsx` | Skeleton toolkit |
| `fms-frontend/src/components/common/LoadingSpinner.tsx` | Legacy name; maps to PageSkeleton |
| `fms-frontend/src/components/dashboard/Dashboard.tsx` | DashboardSkeleton, cache-first |
| `docs/INDUSTRIAL_UI_DESIGN_SPEC.md` | Visual tokens |
| `USER_GUIDE.html` | Staff-facing § Loading & empty lists |
| `SOFTWARE_DOCUMENTATION.html` | Technical § UI loading & empty states |
