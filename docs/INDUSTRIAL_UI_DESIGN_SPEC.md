# Industrial-Level UI Design Spec

**Doc version:** 0.1 (v0.1 for review)  
**Target:** Modern industrial look + consistent UX across **all Pages, Sections, and Dashboards**  
**Stack:** React + Vite + Ant Design (ConfigProvider theme + component style overrides)

---

## 0) Goal (what “industrial level” means here)
- **Crisp hierarchy**: strong page titles, consistent section headers, predictable spacing.
- **Industrial palette**: cool blues + warm orange accents (only for actions/alerts), dark surfaces for depth.
- **Reusable templates**: every page uses the same shell, page header, cards, tables, and empty/loading states.
- **Fast scanning**: dashboards use dense card grids, compact filters, and consistent chart containers.
- **Consistent states**: empty/failed/locked/suspended messages look the same everywhere.

---

## 1) Global Visual Tokens (colors, borders, surfaces)

Use these as the “single source of truth” for the UI theme.

### 1.1 Color palette (recommended defaults)
- **Primary (links, focus, primary actions):** `#2563EB`
- **Accent / Industrial orange (primary CTA, highlight):** `#F59E0B`
- **Danger (errors, critical badges):** `#EF4444`
- **Success (green states):** `#22C55E`
- **Info (secondary emphasis):** `#0EA5E9`

### 1.2 Surfaces & borders
- **Light mode background:** `#F5F7FB`
- **Dark surface (for side panels / cards in dark areas):** `#0B1220`
- **Card / panel surface (light):** `#FFFFFF`
- **Text (main):** `#0F172A`
- **Text (secondary):** `#64748B`
- **Border (default):** `#E5E7EB`
- **Border (dark):** `rgba(148,163,184,0.35)`

### 1.3 Radii + shadows (industrial depth but not “neumorphism”)
- **Radius (card):** `12px`
- **Radius (buttons):** `10px`
- **Shadow (cards):** `0 10px 30px rgba(2,6,23,0.08)`

### 1.4 Spacing system
- Use an **8px grid**:
  - Page padding: `24px` (desktop)
  - Section padding: `16px`
  - Card padding: `16px`
  - Gaps: `12px` / `16px` (match between pages)

---

## 2) Ant Design Theming Rules (how to implement)
Implement with **ConfigProvider theme tokens** first (to avoid per-page hacks).

### 2.1 Theme overrides (must)
- Buttons:
  - Primary button background = Accent orange
  - Hover state: slightly darker orange
- Inputs / Selects:
  - Border radius = `10px`
  - Focus border = primary blue
- Cards / Panels:
  - Border = `#E5E7EB` (light) / dark border above
  - Shadow enabled on light mode panels
- Badges / Tags:
  - Critical states use danger red
  - Neutral use blue-gray

### 2.2 Typography rules (must)
- Page title: `24–28px`, weight 700
- Section title: `16–18px`, weight 600
- Table header: `12–13px`, weight 600
- Body: `12–14px`

---

## 3) Page Shell Templates (all pages)

### Template A: “Standard App Page”
Use for: most pages under Sidebar → content area.
1. Top area: page title + optional subtitle
2. Action row: right-aligned buttons (refresh/export/add)
3. Main content in:
   - **Cards grid** (dashboards and KPI pages)
   - **Tables inside card shells** (lists)
4. Loading/empty:
   - Loading skeleton inside the card body
   - Empty state centered inside card body (not full page)

### Template B: “Dashboard”
Use for: Dashboard, Dashboard KPI, Success, Support dashboard.
1. KPI cards: 4–8 cards in responsive grid
2. Chart cards:
   - consistent chart container height per chart type
   - same legend typography
3. Filter bar:
   - compact chips, minimal vertical space
   - default filter values visible

### Template C: “List + Detail”
Use for: Tickets list, Ticket detail, Solutions list.
1. List page:
   - filters as compact controls
   - sticky table header
2. Detail page:
   - two-column layout:
     - left: main fields + status
     - right: actions + activity/timeline blocks (if present)

---

## 4) Component Style Checklist (used everywhere)
Each component must match the same visual language:

### 4.1 Cards / Panels
- Rounded corners (12px)
- Border + subtle shadow
- Section headings inside card bodies use the same font sizes

### 4.2 Buttons
- Primary = Accent orange
- Secondary = Primary blue (outline/soft)
- Danger = red
- Consistent height and padding

### 4.3 Tables
- Header background uses light gray (or dark surface if dark mode)
- Row hover = subtle blue tint
- Empty = Ant empty state inside table container
- Pagination compact spacing

### 4.4 Forms
- Label style consistent
- Inputs with radius 10px and primary focus border
- Error messages in consistent red style

### 4.5 System messages
- Locked/maintenance overlay:
  - dark industrial background
  - title: “System under maintenance”
  - reason + “Please wait.”
- Release refresh bar:
  - bottom fixed industrial blue background
  - orange CTA button

---

## 5) Page-by-Page Design Tasks (PDF review checklist)

For every page below, do the following:
1. Replace any “inline random styling” with shared card/table/page-header components.
2. Ensure spacing and font hierarchy follows Templates A/B/C.
3. Ensure all tables/filters/buttons use the same theme overrides.
4. Align chart container styling with dashboard rules (Template B).

---

## 5.1 Dashboard (main)
**Blocks**
- KPI summary cards grid
- Trends/charts area
- Small supporting tables (if any)
**Requirements**
- KPI cards: consistent heights, same icon/badge placement
- Chart cards: single standard padding + title style
- Filters: compact, no large form layout

---

## 5.2 Dashboard KPI (person dashboards)
**Blocks**
- Person chooser header / filter bar
- KPI card grid
- KPI charts (bars/lines)
- Supporting breakdown blocks (if present)
**Requirements**
- Filters visible but compact
- Charts use consistent container height and color palette
- Tables inside cards use the same density everywhere

---

## 5.3 Support Dashboard
**Blocks**
- Stats cards (counts by status/queue)
- “Feature tickets” list previews
- Optional charts
**Requirements**
- Cards use industrial border + shadow
- Lists: same table style as Tickets page

---

## 5.4 Tickets (Support / all sub-sections)
Includes: **Chores & Bugs**, **Feature**, **Approval Status**, **Register of Tickets**, **Staging**

### Tickets List Page
**Requirements**
- Filter UI compact and consistent (no per-section UI drift)
- Table:
  - status badges use same color mapping
  - priority/assignee consistently aligned
  - action column style consistent
- Empty state:
  - show “No tickets for this filter” with a single CTA to clear filters

### Ticket Detail Page
**Requirements**
- Two-column layout:
  - left: key attributes + description
  - right: status/actions/audit/timeline blocks
- Update forms/drawers:
  - consistent modal styling
  - consistent button placement (primary CTA last)

---

## 5.5 Task Section
Includes: **Checklist**, **Delegation**

### Checklist Page
**Requirements**
- Filter bar + tasks table/cards grid consistent
- “Add task / Upload / NA modal” follows same modal style

### Delegation Page
**Requirements**
- Delegation tables use the same column typography and badge styles
- Board/list items use consistent card styling

---

## 5.6 Success Section
Includes: **Su -Dash**, **Performance Monitoring**, **Comp- Perform**

**Requirements**
- All KPI/chart containers match dashboard template B
- Performance tables match Tickets table style
- If there are multiple charts per page, each chart card uses same padding/title style

---

## 5.7 Client to Lead
**Requirements**
- List styling matches Tickets (card + table inside)
- Same filter chips + same empty state styling

---

## 5.8 Onboarding
Includes: **Record of Onboarding**

**Requirements**
- Record page uses Template A with consistent header and card grouping
- If it has tables/forms, they must match global table/form styles

---

## 5.9 Training
Includes: **Client Training**

**Requirements**
- Training tables/forms use standard density and spacing
- Chart blocks (if any) use dashboard chart-card container style

---

## 5.10 Client Payment
Includes: **Record of Pending Payment Details**, **Payment Management**, **Payment Ageing Report**, **Comp _ Register**

**Requirements**
- Table/filters consistent across all client payment pages
- “Ageing report” visuals must use the same chart-card and color rules

---

## 5.11 DB Client
Includes: **DB- Dash**, **Client ONB**, **Inactive clients**

**Requirements**
- Standard dashboard cards + list/table blocks
- Same card titles and table styles

---

## 5.12 Users + Section Permissions
Includes: **Users**

**Requirements**
- Tables are consistent (row hover, badge colors, compact density)
- Forms/modals for user edit:
  - clear grouping of role + section permissions
  - prevent huge scroll inside modal (use internal sections)

---

## 5.13 Settings
Includes: **System Control** (lock) and general settings UI

**Requirements**
- “System Control” card styling follows Template A
- Toggle states use industrial orange/blue mapping:
  - ON: accent + warning style
  - OFF: primary/info style
- System lock popup/overlay:
  - Title: “System under maintance” (as agreed)
  - Body: show reason if present, otherwise fallback “Please wait.”

---

## 5.14 Auth Pages (Login / Register / OTP / Password reset)
**Requirements**
- Auth pages should use:
  - consistent brand header
  - centered card container
  - consistent button colors (primary = orange)
- Error messages match global `message.error` visual language

---

## 6) Delivery Plan (implementation phases)
This PDF is the “what to do” checklist. Implementation should be phased:

### Phase 1: Theme foundation (global)
- Implement Ant Design ConfigProvider theme tokens
- Create shared UI components:
  - `IndustrialCard`, `IndustrialPageHeader`, `IndustrialTableShell`

### Phase 2: Dashboard surfaces
- Dashboard + KPI dashboards + Support dashboard

### Phase 3: Lists & Details
- Tickets + Ticket detail + Solutions + Staging

### Phase 4: Tasks / Success / Payments / DB / Users / Settings
- Apply the same templates and verify alignment consistency

### Phase 5: Auth + final polish
- Verify mobile spacing + accessibility (keyboard focus, aria labels)

---

## 7) “Done” Definition
- All pages share consistent spacing, card style, table style, and modal style.
- No page has unique random colors.
- Locked/maintenance and refresh UI look consistent everywhere.

