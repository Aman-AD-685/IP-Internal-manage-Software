import { useEffect, lazy, Suspense } from "react"
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom"
import { useAuth } from "./hooks/useAuth"
import { buildLoginUrl } from "./utils/authRedirect"
import { getDefaultLandingRoute } from "./utils/helpers"
import { LoadingSpinner } from "./components/common/LoadingSpinner"
import { ConfigProvider } from "antd"
import { PageSkeleton } from "./components/common/skeletons"
import { AuthProvider } from "./contexts/AuthProvider"
import { readStoredAuthSession } from "./utils/authSession"
import { AppLayout } from "./components/layout/AppLayout"
import { ProtectedRoute } from "./components/layout/ProtectedRoute"
import { RecoveryRedirectGuard } from "./components/auth/RecoveryRedirectGuard"
import { hasRecoveryRedirectInUrl } from "./utils/recoveryAuth"

import { Register } from "./pages/auth/Register"
import { Login } from "./pages/auth/Login"
import { ResetPassword } from "./pages/auth/ResetPassword"
import { ForgotPassword } from "./pages/auth/ForgotPassword"
import { OTPVerification } from "./pages/auth/OTPVerification"
import { ConfirmationSuccess } from "./pages/auth/ConfirmationSuccess"

import { ErrorBoundary } from "./components/common/ErrorBoundary"
import { GlobalContextMenuProvider } from "./contextMenu"
import { NewFeatureRefreshPrompt } from "./components/common/NewFeatureRefreshPrompt"
import { SystemLockProvider } from "./components/common/SystemLockProvider"

const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })))
const DashboardKPIPage = lazy(() => import("./pages/Dashboard/DashboardKPIPage").then((m) => ({ default: m.DashboardKPIPage })))
const TicketList = lazy(() => import("./pages/Tickets/TicketList").then((m) => ({ default: m.TicketList })))
const TicketDetail = lazy(() => import("./pages/Tickets/TicketDetail").then((m) => ({ default: m.TicketDetail })))
const SolutionList = lazy(() => import("./pages/Solutions/SolutionList").then((m) => ({ default: m.SolutionList })))
const StagingList = lazy(() => import("./pages/Staging/StagingList").then((m) => ({ default: m.StagingList })))
const ChecklistPage = lazy(() => import("./pages/Task/ChecklistPage").then((m) => ({ default: m.ChecklistPage })))
const DelegationPage = lazy(() => import("./pages/Task/DelegationPage").then((m) => ({ default: m.DelegationPage })))
const PerformanceMonitoringPage = lazy(() =>
  import("./pages/Success/PerformanceMonitoringPage").then((m) => ({ default: m.PerformanceMonitoringPage })),
)
const CompPerformPage = lazy(() => import("./pages/Success/CompPerformPage").then((m) => ({ default: m.CompPerformPage })))
const SuccessDashboardPage = lazy(() => import("./pages/Success/DashboardPage").then((m) => ({ default: m.DashboardPage })))
const UserList = lazy(() => import("./pages/Users/UserList").then((m) => ({ default: m.UserList })))
const SettingsPage = lazy(() => import("./pages/Settings/SettingsPage").then((m) => ({ default: m.SettingsPage })))
const ApprovalConfirmPage = lazy(() => import("./pages/Approval/ApprovalConfirmPage").then((m) => ({ default: m.ApprovalConfirmPage })))
const SupportDashboard = lazy(() => import("./pages/Support/SupportDashboard").then((m) => ({ default: m.SupportDashboard })))
const LeadListPage = lazy(() => import("./pages/Leads/LeadListPage").then((m) => ({ default: m.LeadListPage })))
const LeadDetailPage = lazy(() => import("./pages/Leads/LeadDetailPage").then((m) => ({ default: m.LeadDetailPage })))
const LeadImportPage = lazy(() => import("./pages/Leads/LeadImportPage").then((m) => ({ default: m.LeadImportPage })))
const PaymentStatusPage = lazy(() => import("./pages/Onboarding/PaymentStatusPage").then((m) => ({ default: m.PaymentStatusPage })))
const ClientPaymentPage = lazy(() => import("./pages/Onboarding/ClientPaymentPage"))
const PaymentAgeingReportPage = lazy(() =>
  import("./pages/Onboarding/PaymentAgeingReportPage").then((m) => ({ default: m.PaymentAgeingReportPage })),
)
const PendingPaymentDetailsPage = lazy(() =>
  import("./pages/Onboarding/PendingPaymentDetailsPage").then((m) => ({ default: m.PendingPaymentDetailsPage })),
)
const ClientTrainingPage = lazy(() => import("./pages/Training/ClientTrainingPage").then((m) => ({ default: m.ClientTrainingPage })))
const ClientOnbPage = lazy(() => import("./pages/DbClient/ClientOnbPage").then((m) => ({ default: m.ClientOnbPage })))
const DbDashPage = lazy(() => import("./pages/DbClient/DbDashPage").then((m) => ({ default: m.DbDashPage })))
const AccessDeniedPage = lazy(() => import("./pages/AccessDeniedPage").then((m) => ({ default: m.AccessDeniedPage })))

import {
  ROUTES,
  ROLES,
  APP_NAME,
  TICKET_ROUTE_SECTION_KEYS,
  DB_CLIENT_DB_DASH_ALLOWED_EMAILS,
  PENDING_PAYMENT_DETAILS_ALLOWED_EMAILS,
} from "./utils/constants"

function RootRedirect() {
  const { isAuthenticated, isLoading, user } = useAuth()
  const hasStoredSession = readStoredAuthSession().hasSession
  if (hasRecoveryRedirectInUrl()) {
    const target = `${ROUTES.RESET_PASSWORD}${window.location.search}${window.location.hash}`
    return <Navigate to={target} replace />
  }
  if (isLoading && !hasStoredSession) return <LoadingSpinner fullPage />
  if (isAuthenticated && user) {
    return <Navigate to={getDefaultLandingRoute(user)} replace />
  }
  return <Navigate to={ROUTES.LOGIN} replace />
}

function CatchAllRedirect() {
  const location = useLocation()
  const { isAuthenticated, isLoading } = useAuth()
  const hasStoredSession = readStoredAuthSession().hasSession
  if (isLoading && !hasStoredSession) return <LoadingSpinner fullPage />
  if (isAuthenticated) {
    return <Navigate to={ROUTES.ACCESS_DENIED} replace />
  }
  return (
    <Navigate
      to={buildLoginUrl(location.pathname + location.search + location.hash)}
      replace
    />
  )
}

function AppTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    const titles: Record<string, string> = {
      [ROUTES.LOGIN]: "Login — Industryprime",
      [ROUTES.FORGOT_PASSWORD]: "Forgot password",
      [ROUTES.RESET_PASSWORD]: "Reset password",
      [ROUTES.REGISTER]: "Register — Industry Prime",
      [ROUTES.DASHBOARD]: "Dashboard",
      [ROUTES.DASHBOARD_KPI]: "Dashboard - KPI",
      [ROUTES.SUCCESS_DASHBOARD]: "Success Dashboard",
      [ROUTES.SUPPORT_DASHBOARD]: "Support Dashboard",
      [ROUTES.SU_DASH]: "Su -Dash",
      [ROUTES.TICKETS]: "Tickets",
      [ROUTES.STAGING]: "Staging",
      [ROUTES.CHECKLIST]: "Checklist",
      [ROUTES.DELEGATION]: "Delegation",
      [ROUTES.SUCCESS_PERFORMANCE]: "Performance Monitoring",
      [ROUTES.SUCCESS_COMP_PERFORM]: "Comp- Perform",
      [ROUTES.CLIENT_TO_LEAD]: "Client to Lead",
      [ROUTES.LEADS]: "Lead",
      [ROUTES.LEADS_IMPORT]: "Import from sheet",
      [ROUTES.ONBOARDING_PAYMENT_STATUS]: "Onboarding – Payment Status",
      [ROUTES.CLIENT_PAYMENT]: "Payment Management",
      [ROUTES.CLIENT_PAYMENT_PENDING_DETAILS]: "Pending Payment Details",
      [ROUTES.CLIENT_PAYMENT_COMP_REGISTER]: "Comp _ Register",
      [ROUTES.CLIENT_PAYMENT_Q_COMP]: "Q-Comp",
      [ROUTES.CLIENT_PAYMENT_M_COMP]: "M-Comp",
      [ROUTES.CLIENT_PAYMENT_HF_COMP]: "HF-Comp",
      [ROUTES.CLIENT_PAYMENT_PAYMENT_AGEING]: "Payment Ageing Report",
      [ROUTES.TRAINING_CLIENT]: "Client Training",
      [ROUTES.DB_CLIENT_CLIENT_ONB]: "DB Client – Client ONB",
      [ROUTES.DB_CLIENT_CLIENT_ONB_INACTIVE]: "DB Client – Inactive clients",
      [ROUTES.DB_CLIENT_DB_DASH]: "DB Client – DB- Dash",
      [ROUTES.USERS]: "Users",
      [ROUTES.SETTINGS]: "Settings",
      [ROUTES.ACCESS_DENIED]: "Access denied",
    }
    const page = titles[pathname] || (pathname.startsWith("/tickets") ? "Ticket" : pathname.startsWith("/client-to-lead/leads/") ? "Lead Detail" : pathname.startsWith("/onboarding") ? "Onboarding" : APP_NAME)
    const isPublicAuth =
      pathname === ROUTES.LOGIN ||
      pathname === ROUTES.FORGOT_PASSWORD ||
      pathname === ROUTES.REGISTER ||
      pathname === ROUTES.RESET_PASSWORD
    document.title = isPublicAuth
      ? page
      : `${APP_NAME} - ${page}`
  }, [pathname])
  return null
}

function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#4A6BFF",
          colorBgLayout: "#F5F7FB",
          colorBgContainer: "#FFFFFF",
          colorText: "#343A40",
          colorTextSecondary: "#6C757D",
          borderRadius: 8,
        },
        components: {
          Card: {
            borderRadiusLG: 8,
          },
        },
      }}
    >
      <AuthProvider>
        <BrowserRouter>
          <NewFeatureRefreshPrompt />
          <SystemLockProvider>
          <RecoveryRedirectGuard />
          <GlobalContextMenuProvider>
          <AppTitle />
          <Suspense fallback={<PageSkeleton />}>
          <Routes>
            {/* ================= PUBLIC ROUTES ================= */}
            <Route path={ROUTES.REGISTER} element={<Register />} />
            <Route path={ROUTES.LOGIN} element={<Login />} />
            <Route path={ROUTES.FORGOT_PASSWORD} element={<ForgotPassword />} />
            <Route path={ROUTES.RESET_PASSWORD} element={<ResetPassword />} />
            <Route path={ROUTES.OTP} element={<OTPVerification />} />
            <Route
              path={ROUTES.CONFIRMATION_SUCCESS}
              element={<ConfirmationSuccess />}
            />
            {/* Email confirmation callback route */}
            <Route
              path="/auth/confirm"
              element={<ConfirmationSuccess />}
            />
            {/* Email approval link (public, token in query) */}
            <Route path="/approval/confirm" element={<ApprovalConfirmPage />} />

            {/* ================= PROTECTED ROUTES ================= */}
            <Route
              path={ROUTES.ACCESS_DENIED}
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <AccessDeniedPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path={ROUTES.DASHBOARD}
              element={
                <ProtectedRoute sectionKeys={["dashboard"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <Dashboard />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path={ROUTES.DASHBOARD_KPI}
              element={
                <ProtectedRoute sectionKeys={["dashboard_kpi", "dashboard"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <DashboardKPIPage />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path={ROUTES.SUPPORT_DASHBOARD}
              element={
                <ProtectedRoute sectionKeys={["support_dashboard"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <SupportDashboard />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path={ROUTES.SU_DASH}
              element={
                <ProtectedRoute sectionKeys={["support_dashboard"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <SuccessDashboardPage />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path={ROUTES.TICKETS}
              element={
                <ProtectedRoute sectionKeys={[...TICKET_ROUTE_SECTION_KEYS]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <TicketList />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path={`${ROUTES.TICKETS}/:id`}
              element={
                <ProtectedRoute sectionKeys={[...TICKET_ROUTE_SECTION_KEYS]}>
                  <AppLayout>
                    <TicketDetail />
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path={ROUTES.SOLUTIONS.replace(":ticketId", ":ticketId")}
              element={
                <ProtectedRoute sectionKeys={["solution"]}>
                  <AppLayout>
                    <SolutionList />
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path={ROUTES.STAGING}
              element={
                <ProtectedRoute sectionKeys={["staging"]}>
                  <AppLayout>
                    <StagingList />
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path={ROUTES.CHECKLIST}
              element={
                <ProtectedRoute sectionKeys={["task"]}>
                  <AppLayout>
                    <ChecklistPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path={ROUTES.DELEGATION}
              element={
                <ProtectedRoute sectionKeys={["task"]}>
                  <AppLayout>
                    <DelegationPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path={ROUTES.SUCCESS_DASHBOARD}
              element={
                <ProtectedRoute sectionKeys={["success_performance"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <DashboardKPIPage forceOpen defaultPerson="Shreyasi" />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path={ROUTES.SUCCESS_PERFORMANCE}
              element={
                <ProtectedRoute sectionKeys={["success_performance"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <PerformanceMonitoringPage />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.SUCCESS_COMP_PERFORM}
              element={
                <ProtectedRoute sectionKeys={["success_comp_perform"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <CompPerformPage />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path={ROUTES.LEADS}
              element={
                <ProtectedRoute sectionKeys={["leads", "client_to_lead"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <LeadListPage />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.LEAD_DETAIL}
              element={
                <ProtectedRoute sectionKeys={["leads", "client_to_lead"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <LeadDetailPage />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.LEADS_IMPORT}
              element={
                <ProtectedRoute sectionKeys={["leads", "client_to_lead"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <LeadImportPage />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.ONBOARDING_PAYMENT_STATUS}
              element={
                <ProtectedRoute sectionKeys={["onboarding_payment_status", "onboarding"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <PaymentStatusPage />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.CLIENT_PAYMENT}
              element={
                <ProtectedRoute sectionKeys={["client_payment"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <ClientPaymentPage />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.CLIENT_PAYMENT_PENDING_DETAILS}
              element={
                <ProtectedRoute
                  emailAllowlist={PENDING_PAYMENT_DETAILS_ALLOWED_EMAILS}
                >
                  <AppLayout>
                    <ErrorBoundary>
                      <PendingPaymentDetailsPage />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route path={ROUTES.CLIENT_PAYMENT_Q_COMP} element={<Navigate to={`${ROUTES.CLIENT_PAYMENT_COMP_REGISTER}?genre=Q`} replace />} />
            <Route path={ROUTES.CLIENT_PAYMENT_M_COMP} element={<Navigate to={`${ROUTES.CLIENT_PAYMENT_COMP_REGISTER}?genre=M`} replace />} />
            <Route path={ROUTES.CLIENT_PAYMENT_HF_COMP} element={<Navigate to={`${ROUTES.CLIENT_PAYMENT_COMP_REGISTER}?genre=HY`} replace />} />
            <Route path={ROUTES.CLIENT_PAYMENT_COMP_REGISTER} element={<ProtectedRoute sectionKeys={["client_payment"]}><AppLayout><ErrorBoundary><ClientPaymentPage /></ErrorBoundary></AppLayout></ProtectedRoute>} />
            <Route
              path={ROUTES.CLIENT_PAYMENT_PAYMENT_AGEING}
              element={
                <ProtectedRoute sectionKeys={["client_payment"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <PaymentAgeingReportPage />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.TRAINING_CLIENT}
              element={
                <ProtectedRoute sectionKeys={["training"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <ClientTrainingPage />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route path="/db-client/clients" element={<Navigate to={ROUTES.DB_CLIENT_CLIENT_ONB} replace />} />
            <Route
              path={ROUTES.DB_CLIENT_DB_DASH}
              element={
                <ProtectedRoute
                  sectionKeys={["db_client"]}
                  emailAllowlist={DB_CLIENT_DB_DASH_ALLOWED_EMAILS}
                >
                  <AppLayout>
                    <ErrorBoundary>
                      <DbDashPage />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.DB_CLIENT_CLIENT_ONB_INACTIVE}
              element={
                <ProtectedRoute sectionKeys={["db_client"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <ClientOnbPage mode="inactive" />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.DB_CLIENT_CLIENT_ONB}
              element={
                <ProtectedRoute sectionKeys={["db_client"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <ClientOnbPage mode="active" />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path={ROUTES.USERS}
              element={
                <ProtectedRoute requiredRole={ROLES.ADMIN} sectionKeys={["users"]}>
                  <AppLayout>
                    <ErrorBoundary>
                      <UserList />
                    </ErrorBoundary>
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path={ROUTES.SETTINGS}
              element={
                <ProtectedRoute requiredRole={ROLES.ADMIN} sectionKeys={["settings"]}>
                  <AppLayout>
                    <SettingsPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />

            {/* ================= DEFAULT ROUTES ================= */}

            {/* App root → login */}
            <Route path="/" element={<RootRedirect />} />

            {/* Unknown routes */}
            <Route path="*" element={<CatchAllRedirect />} />
          </Routes>
          </Suspense>
          </GlobalContextMenuProvider>
          </SystemLockProvider>
        </BrowserRouter>
      </AuthProvider>
    </ConfigProvider>
  )
}

export default App
