# Mobile documentation & app navigation

## Standalone HTML docs (`USER_GUIDE.html`, `SOFTWARE_DOCUMENTATION.html`)

| Item | Detail |
|------|--------|
| Severity | Critical UX for HTML docs on mobile |
| Root cause | `@media (max-width:900px){ nav.toc{display:none} }` with no alternate control |
| Fix | Sticky **☰ Menu** top bar; same `nav.toc` opens full-screen via `body.doc-nav-open` |
| Staff steps | `USER_GUIDE.html` § **Using this guide on a phone** (`#phone`) |

## Live React app (`fms-frontend`)

Matches the product doc guidance for phones (hamburger full-screen drawer + bottom tabs):

| Piece | Behavior |
|-------|----------|
| Header **☰** | Opens Ant Design `Drawer` sidebar (`Sidebar.tsx`) |
| Drawer ≤767px | **Full screen** (`width: 100%`) + closable **×** |
| Drawer ≥768px | 260px left drawer (unchanged) |
| Bottom tabs ≤767px | **Dashboard** · **Tickets** · **Tasks** · **More** (`MobileBottomNav.tsx`) |
| More | Opens the full sidebar drawer |
| Header compaction | Long labels (Improvement, Dashboard-KPI, user name) hidden; icons remain |

Breakpoints: nav shell uses **767px** (`useIsMobileNav` / `responsive.css`). HTML docs TOC uses **900px**.

## Files

- `fms-frontend/src/hooks/useIsMobileNav.ts`
- `fms-frontend/src/components/layout/MobileBottomNav.tsx`
- `fms-frontend/src/components/layout/Sidebar.tsx`, `AppLayout.tsx`, `Header.tsx`
- `fms-frontend/src/styles/responsive.css`
- HTML: `USER_GUIDE.html`, `SOFTWARE_DOCUMENTATION.html`

## Test plan

1. HTML docs ≤900px: Menu opens TOC; section tap closes and jumps; print hides TOC.
2. App ≤767px: ☰ opens full-screen menu; bottom tabs navigate; More opens drawer.
3. App ≥768px: no bottom bar; drawer 260px.
4. Permissions: tabs appear only for sections the user can view.
