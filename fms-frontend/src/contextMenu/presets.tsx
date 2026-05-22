import {
  CopyOutlined,
  ExportOutlined,
  LinkOutlined,
  PrinterOutlined,
  ReloadOutlined,
  StarOutlined,
  CheckOutlined,
  EditOutlined,
  CloseOutlined,
  FileTextOutlined,
  UserAddOutlined,
  BarChartOutlined,
  DownloadOutlined,
  ShareAltOutlined,
  PushpinOutlined,
  ColumnWidthOutlined,
  WindowsOutlined,
} from '@ant-design/icons'
import type { ContextMenuItemDef } from './types'
import { absoluteAppUrl, copyToClipboard, openInNewTab, openInNewWindow } from './utils'

export interface NavMenuHandlers {
  navigate: (path: string) => void
  onRefresh?: () => void
}

export interface PageSurfaceHandlers {
  onRefresh?: () => void
  onReloadData?: () => void
  title?: string
  /** Current in-app path (e.g. /delegation or /tickets?section=chores-bugs) for open-in-new-tab */
  pageUrl?: string
}

export interface DelegationRowHandlers {
  taskUrl: string
  canAct: boolean
  isMasterAdmin: boolean
  onOpen?: () => void
  onComplete?: () => void
  onEdit?: () => void
  onCancel?: () => void
  onReload?: () => void
  onPrint?: () => void
  onExport?: () => void
}

export interface ReportMenuHandlers {
  reportUrl?: string
  onOpen?: () => void
  onPrint?: () => void
  onExportExcel?: () => void
  onDownloadPdf?: () => void
}

function linkItems(url: string): ContextMenuItemDef[] {
  const abs = url.startsWith('http') ? url : absoluteAppUrl(url)
  return [
    {
      id: 'open-new-tab',
      label: 'Open in New Tab',
      icon: <ExportOutlined />,
      shortcut: 'Ctrl+click',
      onSelect: () => openInNewTab(abs),
    },
    {
      id: 'open-new-window',
      label: 'Open in New Window',
      icon: <WindowsOutlined />,
      onSelect: () => openInNewWindow(abs),
    },
    {
      id: 'copy-link',
      label: 'Copy Link',
      icon: <LinkOutlined />,
      shortcut: 'Ctrl+C',
      onSelect: () => void copyToClipboard(abs),
    },
  ]
}

/** Right-click on header / toolbar / form action buttons with a navigable href */
export function buildActionButtonMenu(
  openHref: string,
  label: string,
  handlers?: { onOpen?: () => void },
): ContextMenuItemDef[] {
  const full = openHref.startsWith('/') || openHref.startsWith('http') ? openHref : `/${openHref}`
  const items: ContextMenuItemDef[] = []
  if (handlers?.onOpen) {
    items.push({
      id: 'open',
      label: `Open ${label}`,
      icon: <FileTextOutlined />,
      onSelect: handlers.onOpen,
    })
  }
  items.push(...linkItems(full))
  items.push(
    { id: 'sep', type: 'separator' },
    {
      id: 'copy-link',
      label: 'Copy Link',
      icon: <LinkOutlined />,
      onSelect: () => void copyToClipboard(full.startsWith('http') ? full : absoluteAppUrl(full)),
    },
  )
  return items
}

export function buildCommonLinkItems(url: string, onOpen?: () => void): ContextMenuItemDef[] {
  const items: ContextMenuItemDef[] = []
  if (onOpen) {
    items.push({
      id: 'open',
      label: 'Open',
      icon: <FileTextOutlined />,
      onSelect: onOpen,
    })
  }
  items.push(...linkItems(url))
  return items
}

/** Right-click on sidebar / nav items */
export function buildNavItemMenu(
  routeKey: string,
  label: string,
  handlers: NavMenuHandlers,
): ContextMenuItemDef[] {
  const full = routeKey.startsWith('/') ? routeKey : `/${routeKey}`
  return [
    {
      id: 'open',
      label: 'Open',
      icon: <FileTextOutlined />,
      onSelect: () => handlers.navigate(full),
    },
    ...linkItems(full),
    { id: 'sep-1', type: 'separator' },
    {
      id: 'open-split',
      label: 'Open in Split View',
      icon: <ColumnWidthOutlined />,
      disabled: true,
    },
    {
      id: 'pin',
      label: 'Pin Section',
      icon: <PushpinOutlined />,
      disabled: true,
    },
    {
      id: 'favorite',
      label: 'Favorite',
      icon: <StarOutlined />,
      disabled: true,
    },
    { id: 'sep-2', type: 'separator' },
    {
      id: 'refresh',
      label: 'Refresh Section',
      icon: <ReloadOutlined />,
      onSelect: () => (handlers.onRefresh ? handlers.onRefresh() : window.location.reload()),
    },
    {
      id: 'inspect',
      label: 'Inspect Details',
      icon: <FileTextOutlined />,
      onSelect: () => copyToClipboard(`${label} → ${absoluteAppUrl(full)}`),
    },
  ]
}

/** Right-click on empty page / content area */
export function buildPageSurfaceMenu(handlers: PageSurfaceHandlers): ContextMenuItemDef[] {
  const pagePath = handlers.pageUrl?.trim()
  const linkBlock =
    pagePath && pagePath.startsWith('/')
      ? [{ id: 'sep-links', type: 'separator' as const }, ...linkItems(pagePath)]
      : []

  return [
    {
      id: 'reload-data',
      label: 'Reload Data',
      icon: <ReloadOutlined />,
      onSelect: () => handlers.onReloadData?.(),
    },
    {
      id: 'refresh',
      label: 'Refresh Section',
      icon: <ReloadOutlined />,
      shortcut: 'Ctrl+R',
      onSelect: () => (handlers.onRefresh ? handlers.onRefresh() : window.location.reload()),
    },
    { id: 'sep', type: 'separator' },
    {
      id: 'print',
      label: 'Print',
      icon: <PrinterOutlined />,
      shortcut: 'Ctrl+P',
      onSelect: () => window.print(),
    },
    {
      id: 'inspect',
      label: 'Inspect Details',
      icon: <FileTextOutlined />,
      onSelect: () => copyToClipboard(handlers.title || document.title),
    },
    ...linkBlock,
  ]
}

export interface ChecklistRowHandlers {
  taskUrl: string
  canComplete: boolean
  onOpen?: () => void
  onComplete?: () => void
  onReload?: () => void
}

/** Checklist table row */
export function buildChecklistRowMenu(h: ChecklistRowHandlers): ContextMenuItemDef[] {
  return [
    {
      id: 'open-task',
      label: 'Open Task',
      icon: <FileTextOutlined />,
      onSelect: () => h.onOpen?.(),
    },
    ...linkItems(h.taskUrl),
    { id: 'sep', type: 'separator' },
    {
      id: 'complete',
      label: 'Complete Task',
      icon: <CheckOutlined />,
      disabled: !h.canComplete,
      onSelect: () => h.onComplete?.(),
    },
    {
      id: 'copy-link',
      label: 'Copy Task Link',
      icon: <CopyOutlined />,
      onSelect: () => copyToClipboard(h.taskUrl.startsWith('http') ? h.taskUrl : absoluteAppUrl(h.taskUrl)),
    },
    {
      id: 'reload',
      label: 'Reload Data',
      icon: <ReloadOutlined />,
      onSelect: () => h.onReload?.(),
    },
  ]
}

/** Delegation table row */
export function buildDelegationRowMenu(h: DelegationRowHandlers): ContextMenuItemDef[] {
  const items: ContextMenuItemDef[] = [
    {
      id: 'open-task',
      label: 'Open Task',
      icon: <FileTextOutlined />,
      onSelect: () => h.onOpen?.(),
    },
    ...linkItems(h.taskUrl),
    { id: 'sep-1', type: 'separator' },
    {
      id: 'copy-task-link',
      label: 'Copy Task Link',
      icon: <CopyOutlined />,
      onSelect: () => copyToClipboard(h.taskUrl.startsWith('http') ? h.taskUrl : absoluteAppUrl(h.taskUrl)),
    },
  ]

  if (h.canAct) {
    items.push(
      { id: 'sep-2', type: 'separator' },
      {
        id: 'complete',
        label: 'Complete Task',
        icon: <CheckOutlined />,
        onSelect: () => h.onComplete?.(),
      },
      {
        id: 'cancel',
        label: 'Cancel Task',
        icon: <CloseOutlined />,
        danger: true,
        onSelect: () => h.onCancel?.(),
      },
    )
    if (h.isMasterAdmin) {
      items.push({
        id: 'edit',
        label: 'Edit Task',
        icon: <EditOutlined />,
        onSelect: () => h.onEdit?.(),
      })
      items.push({
        id: 'assign',
        label: 'Assign User',
        icon: <UserAddOutlined />,
        onSelect: () => h.onEdit?.(),
      })
    }
  }

  items.push(
    { id: 'sep-3', type: 'separator' },
    {
      id: 'view-logs',
      label: 'View Logs',
      icon: <FileTextOutlined />,
      disabled: true,
    },
    {
      id: 'export-task',
      label: 'Export Task',
      icon: <ExportOutlined />,
      onSelect: () => h.onExport?.(),
    },
    {
      id: 'print-task',
      label: 'Print Task',
      icon: <PrinterOutlined />,
      onSelect: () => (h.onPrint ? h.onPrint() : window.print()),
    },
    {
      id: 'reload',
      label: 'Reload Data',
      icon: <ReloadOutlined />,
      onSelect: () => h.onReload?.(),
    },
  )

  return items
}

/** Report / export surfaces */
export function buildReportMenu(h: ReportMenuHandlers): ContextMenuItemDef[] {
  const url = h.reportUrl || window.location.pathname
  return [
    {
      id: 'open-report',
      label: 'Open Report',
      icon: <BarChartOutlined />,
      onSelect: () => h.onOpen?.(),
    },
    ...(h.reportUrl ? linkItems(h.reportUrl) : []),
    { id: 'sep', type: 'separator' },
    {
      id: 'download-pdf',
      label: 'Download PDF',
      icon: <DownloadOutlined />,
      onSelect: () => h.onDownloadPdf?.(),
      disabled: !h.onDownloadPdf,
    },
    {
      id: 'export-excel',
      label: 'Export Excel',
      icon: <ExportOutlined />,
      onSelect: () => h.onExportExcel?.(),
      disabled: !h.onExportExcel,
    },
    {
      id: 'print',
      label: 'Print Report',
      icon: <PrinterOutlined />,
      onSelect: () => (h.onPrint ? h.onPrint() : window.print()),
    },
    {
      id: 'analytics',
      label: 'Open Analytics',
      icon: <BarChartOutlined />,
      disabled: true,
    },
    {
      id: 'share',
      label: 'Share Link',
      icon: <ShareAltOutlined />,
      onSelect: () => copyToClipboard(absoluteAppUrl(url)),
    },
  ]
}
