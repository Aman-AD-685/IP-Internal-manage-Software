import type { ThemeConfig } from 'antd'

/** Industrial palette — matches docs/INDUSTRIAL_UI_DESIGN_SPEC.md */
export const INDUSTRIAL = {
  primary: '#60A5FA',
  accent: '#F59E0B',
  accentHover: '#D97706',
  bgLayout: '#F5F7FB',
  bgContainer: '#FFFFFF',
  sidebar: '#EEF1F6',
  text: '#0F172A',
  textSecondary: '#64748B',
  border: '#E5E7EB',
  tableHeaderBg: '#F8FAFC',
  success: '#22C55E',
  danger: '#EF4444',
  radiusCard: 12,
  radiusControl: 10,
} as const

export const industrialTheme: ThemeConfig = {
  token: {
    colorPrimary: INDUSTRIAL.primary,
    colorSuccess: INDUSTRIAL.success,
    colorError: INDUSTRIAL.danger,
    colorWarning: INDUSTRIAL.accent,
    colorBgLayout: INDUSTRIAL.bgLayout,
    colorBgContainer: INDUSTRIAL.bgContainer,
    colorText: INDUSTRIAL.text,
    colorTextSecondary: INDUSTRIAL.textSecondary,
    colorBorder: INDUSTRIAL.border,
    borderRadius: INDUSTRIAL.radiusControl,
    fontSize: 13,
    fontFamily:
      "'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
  },
  components: {
    Button: {
      colorPrimary: INDUSTRIAL.accent,
      primaryColor: INDUSTRIAL.text,
      primaryShadow: '0 2px 0 rgba(245, 158, 11, 0.12)',
      borderRadius: INDUSTRIAL.radiusControl,
      controlHeight: 36,
      fontWeight: 600,
    },
    Input: {
      borderRadius: INDUSTRIAL.radiusControl,
      controlHeight: 36,
      colorBorder: INDUSTRIAL.border,
      activeBorderColor: INDUSTRIAL.primary,
      hoverBorderColor: '#BFDBFE',
    },
    InputNumber: {
      borderRadius: INDUSTRIAL.radiusControl,
      controlHeight: 36,
    },
    Select: {
      borderRadius: INDUSTRIAL.radiusControl,
      controlHeight: 36,
    },
    DatePicker: {
      borderRadius: INDUSTRIAL.radiusControl,
      controlHeight: 36,
    },
    Card: {
      borderRadiusLG: INDUSTRIAL.radiusCard,
      paddingLG: 16,
    },
    Table: {
      headerBg: INDUSTRIAL.tableHeaderBg,
      headerColor: INDUSTRIAL.text,
      headerSplitColor: INDUSTRIAL.border,
      borderColor: INDUSTRIAL.border,
      rowHoverBg: '#F1F5F9',
    },
    Modal: {
      borderRadiusLG: INDUSTRIAL.radiusCard,
    },
    Drawer: {
      borderRadiusLG: INDUSTRIAL.radiusCard,
    },
    Tabs: {
      itemSelectedColor: INDUSTRIAL.primary,
      inkBarColor: INDUSTRIAL.primary,
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Alert: {
      borderRadiusLG: INDUSTRIAL.radiusControl,
    },
    Form: {
      labelColor: INDUSTRIAL.text,
      verticalLabelPadding: '0 0 6px',
    },
    Menu: {
      itemSelectedColor: '#FFFFFF',
      itemSelectedBg: INDUSTRIAL.primary,
    },
  },
}
