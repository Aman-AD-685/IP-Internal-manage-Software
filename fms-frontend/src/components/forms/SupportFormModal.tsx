import { useState, useEffect, useRef, useCallback } from 'react'
import { Modal, Form, Input, Select, DatePicker, Upload, message } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { ticketsApi, type SimilarTicketsResponse } from '../../api/tickets'
import { supportApi } from '../../api/support'
import { draftsApi } from '../../api/drafts'
import { uploadAttachment } from '../../api/upload'
import { useAuth } from '../../hooks/useAuth'
import type { Company, Page, Division } from '../../api/support'
import { dedupeCompaniesForSelect } from '../../utils/companiesDedupe'
import { TICKET_PRIORITY_OPTIONS, normalizePriorityValue } from '../../utils/ticketPriority'
import { SimilarTicketsPanel } from './SimilarTicketsPanel'
import { ChoresBugsDetailDrawer } from '../tickets/ChoresBugsDetailDrawer'
import { TicketDetailDrawer } from '../tickets/TicketDetailDrawer'
const { TextArea } = Input
const { Dragger } = Upload

const DRAFT_DEBOUNCE_MS = 800
const SIMILAR_TICKETS_DEBOUNCE_MS = 400
const SIMILAR_TITLE_MIN_LEN = 6

/** Serialize DatePicker value (dayjs or Date) to ISO string for the API */
function toISODate(val: unknown): string | undefined {
  if (val == null) return undefined
  if (typeof val === 'string') return val
  const v = val as { toISOString?: () => string; valueOf?: () => number }
  if (typeof v.toISOString === 'function') return v.toISOString()
  if (typeof v.valueOf === 'function') return new Date(v.valueOf()).toISOString()
  return undefined
}

/** Ensure value is sent as string for API (avoids "Input should be a valid string" when backend expects str) */
function toStr(val: unknown): string | undefined {
  if (val == null) return undefined
  if (typeof val === 'string') return val
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  return undefined
}

/** Extract form values as serializable draft (dates as ISO strings) */
function extractDraftData(values: Record<string, unknown>, attachmentUrl: string | null): Record<string, unknown> {
  const d: Record<string, unknown> = {}
  const keys = [
    'company_id',
    'user_name',
    'page_id',
    'division_id',
    'division_other',
    'title',
    'description',
    'type_of_request',
    'communicated_through',
    'submitted_by',
    'quality_of_response',
    'customer_questions',
    'priority',
    'why_feature',
  ]
  for (const k of keys) {
    const v = values[k]
    if (v != null && v !== '') d[k] = v
  }
  const qa = values.query_arrival_at
  if (qa != null) {
    const iso = toISODate(qa)
    if (iso) d.query_arrival_at = iso
  }
  const qr = values.query_response_at
  if (qr != null) {
    const iso = toISODate(qr)
    if (iso) d.query_response_at = iso
  }
  const att = attachmentUrl ?? toStr(values.attachment_url)
  if (att) d.attachment_url = att
  return d
}

/** Turn API error detail (string, array of strings, or FastAPI validation array) into one string */
function formatApiError(detail: unknown, fallback: string): string {
  if (detail == null) return fallback
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d: unknown) =>
        d && typeof d === 'object' && 'msg' in (d as object)
          ? (d as { msg: string }).msg
          : String(d)
      )
      .join(' ')
  }
  if (typeof detail === 'object' && detail !== null && 'message' in (detail as object)) {
    return String((detail as { message: unknown }).message)
  }
  return fallback
}

export interface SupportFormPrefill {
  title?: string
  description?: string
  type_of_request?: 'chore' | 'bug' | 'feature'
  page_id?: string
  attachment_url?: string
  submitted_by?: string
}

interface SupportFormModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: (ticket?: import('../../api/tickets').Ticket) => void
  /** Prefill from IP Details → Move to Soft (skips draft restore). */
  prefill?: SupportFormPrefill | null
}

export const SupportFormModal = ({ open, onClose, onSuccess, prefill }: SupportFormModalProps) => {
  const { user } = useAuth()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [pages, setPages] = useState<Page[]>([])
  const [divisions, setDivisions] = useState<Division[]>([])
  const [divisionOther, setDivisionOther] = useState(false)
  const [typeFeature, setTypeFeature] = useState(false)
  const [requestType, setRequestType] = useState<string>('')
  const showPriorityField =
    requestType === 'feature' || requestType === 'chore' || requestType === 'bug'
  const [uploading, setUploading] = useState(false)
  const [attachmentFileList, setAttachmentFileList] = useState<{ uid: string; name: string; url?: string }[]>([])
  /** Store attachment URL in state so it's always included in submit (hidden field can be missing from validateFields) */
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null)
  const draftSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipDraftSaveRef = useRef(false)
  const isLoadingDraftRef = useRef(false)
  const divisionsFetchGenRef = useRef(0)
  const similarFetchGenRef = useRef(0)
  const similarDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [similarResult, setSimilarResult] = useState<SimilarTicketsResponse | null>(null)
  const [similarLoading, setSimilarLoading] = useState(false)
  const [previewTicketId, setPreviewTicketId] = useState<string | null>(null)
  const [previewTicketType, setPreviewTicketType] = useState<'chore' | 'bug' | 'feature' | null>(null)
  const attachmentUrlRef = useRef<string | null>(null)
  attachmentUrlRef.current = attachmentUrl

  /** Load draft into form when modal opens */
  useEffect(() => {
    if (open) {
      setAttachmentUrl(null)
      setDivisions([])
      setDivisionOther(false)
      setTypeFeature(false)
      setRequestType('')
      setSimilarResult(null)
      setSimilarLoading(false)
      setPreviewTicketId(null)
      setPreviewTicketType(null)
      supportApi
        .getCompanies()
        .then((list) => setCompanies(dedupeCompaniesForSelect(list)))
        .catch(() => setCompanies([]))
      supportApi.getPages().then(setPages).catch(() => setPages([]))

      if (prefill) {
        skipDraftSaveRef.current = true
        isLoadingDraftRef.current = true
        const t = prefill.type_of_request || 'chore'
        setRequestType(t)
        setTypeFeature(t === 'feature')
        if (prefill.attachment_url) {
          setAttachmentUrl(prefill.attachment_url)
          setAttachmentFileList([{ uid: prefill.attachment_url, name: 'Link', url: prefill.attachment_url }])
        }
        form.setFieldsValue({
          title: prefill.title ?? '',
          description: prefill.description ?? '',
          type_of_request: t,
          page_id: prefill.page_id,
          submitted_by: prefill.submitted_by ?? user?.full_name ?? '',
          attachment_url: prefill.attachment_url,
        })
        setTimeout(() => {
          skipDraftSaveRef.current = false
          isLoadingDraftRef.current = false
        }, 300)
        return
      }

      form.setFieldsValue({ submitted_by: user?.full_name ?? '' })
      skipDraftSaveRef.current = true
      isLoadingDraftRef.current = true
      draftsApi
        .getSupportTicketDraft()
        .then(async (res) => {
          const raw = res as { draft_data?: Record<string, unknown>; data?: { draft_data?: Record<string, unknown> } }
          const data = raw?.draft_data ?? raw?.data?.draft_data
          if (!data || typeof data !== 'object') return
          const fields: Record<string, unknown> = { ...data }
          if (typeof data.query_arrival_at === 'string') {
            fields.query_arrival_at = dayjs(data.query_arrival_at)
          }
          if (typeof data.query_response_at === 'string') {
            fields.query_response_at = dayjs(data.query_response_at)
          }
          const draftType = typeof data.type_of_request === 'string' ? data.type_of_request : ''
          setRequestType(draftType)
          setTypeFeature(draftType === 'feature')
          if (data.company_id) {
            const d = await supportApi.getDivisions(data.company_id as string, { bustCache: true })
            setDivisions(d)
            const hasOther = d.some((x) => x.name === 'Other')
            setDivisionOther(hasOther)
          }
          const attUrl = typeof data.attachment_url === 'string' ? data.attachment_url : null
          if (attUrl) {
            setAttachmentUrl(attUrl)
            setAttachmentFileList([{ uid: attUrl, name: 'Draft attachment', url: attUrl }])
            form.setFieldValue('attachment_url', attUrl)
          }
          form.setFieldsValue(fields)
        })
        .catch(() => {})
        .finally(() => {
          setTimeout(() => {
            skipDraftSaveRef.current = false
            isLoadingDraftRef.current = false
            // If user selected company during draft-load window, fetch divisions now.
            const selectedCompanyId = form.getFieldValue('company_id') as string | undefined
            if (selectedCompanyId) {
              supportApi.getDivisions(selectedCompanyId, { bustCache: true }).then((d) => {
                setDivisions(d)
                setDivisionOther(d.some((x) => x.name === 'Other'))
              })
            }
          }, 500)
        })
    }
  }, [open, user?.full_name, prefill])

  const companyId = Form.useWatch('company_id', form)
  const titleWatch = Form.useWatch('title', form)

  useEffect(() => {
    if (companyId) {
      const fetchGen = ++divisionsFetchGenRef.current
      supportApi
        .getDivisions(companyId, { bustCache: true })
        .then((d) => {
          if (fetchGen !== divisionsFetchGenRef.current) return
          setDivisions(d)
          setDivisionOther(d.some((x) => x.name === 'Other'))
        })
        .catch(() => {
          if (fetchGen !== divisionsFetchGenRef.current) return
          setDivisions([])
        })
      form.setFieldValue('division_id', undefined)
      form.setFieldValue('division_other', undefined)
    } else {
      divisionsFetchGenRef.current += 1
      setDivisions([])
      form.setFieldValue('division_id', undefined)
      form.setFieldValue('division_other', undefined)
    }
  }, [companyId, form])

  const similarScopeReady = String(titleWatch ?? '').trim().length >= SIMILAR_TITLE_MIN_LEN

  useEffect(() => {
    if (!open) return
    similarFetchGenRef.current += 1
    setSimilarResult(null)
    if (similarDebounceRef.current) clearTimeout(similarDebounceRef.current)

    const title = String(titleWatch ?? '').trim()
    if (title.length < SIMILAR_TITLE_MIN_LEN) {
      setSimilarLoading(false)
      return
    }

    setSimilarLoading(true)
    similarDebounceRef.current = setTimeout(() => {
      const fetchGen = ++similarFetchGenRef.current
      ticketsApi
        .getSimilar({ title })
        .then((res) => {
          if (fetchGen !== similarFetchGenRef.current) return
          setSimilarResult(res)
        })
        .catch(() => {
          if (fetchGen !== similarFetchGenRef.current) return
          setSimilarResult(null)
        })
        .finally(() => {
          if (fetchGen === similarFetchGenRef.current) setSimilarLoading(false)
        })
    }, SIMILAR_TICKETS_DEBOUNCE_MS)
    return () => {
      if (similarDebounceRef.current) clearTimeout(similarDebounceRef.current)
    }
  }, [open, titleWatch])

  const handleTypeChange = (val: string) => {
    setRequestType(val)
    setTypeFeature(val === 'feature')
    if (val !== 'feature') {
      form.setFieldValue('why_feature', undefined)
    }
  }

  const handleDivisionChange = (val: string) => {
    const div = divisions.find((d) => d.id === val)
    setDivisionOther(div?.name === 'Other')
  }

  const saveDraft = useCallback(() => {
    if (skipDraftSaveRef.current) return
    const values = form.getFieldsValue()
    const draftData = extractDraftData(values, attachmentUrlRef.current)
    if (Object.keys(draftData).length === 0) return
    draftsApi.saveSupportTicketDraft(draftData).catch(() => {})
  }, [])

  const scheduleDraftSave = useCallback(() => {
    if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current)
    draftSaveTimeoutRef.current = setTimeout(() => {
      draftSaveTimeoutRef.current = null
      saveDraft()
    }, DRAFT_DEBOUNCE_MS)
  }, [saveDraft])

  const createTicketFromForm = async (
    values: Record<string, unknown>,
    repeatOfTicketId?: string
  ) => {
    const finalAttachmentUrl = attachmentUrl ?? toStr(values.attachment_url) ?? undefined
    const createRes = (await ticketsApi.create({
      title: toStr(values.title) ?? '',
      description: toStr(values.description),
      type: (toStr(values.type_of_request) ?? 'chore') as 'feature' | 'chore' | 'bug',
      priority: normalizePriorityValue(toStr(values.priority)),
      company_id: toStr(values.company_id),
      page_id: toStr(values.page_id),
      division_id: toStr(values.division_id),
      division_other: toStr(values.division_other),
      attachment_url: finalAttachmentUrl,
      user_name: toStr(values.user_name),
      communicated_through: toStr(values.communicated_through),
      submitted_by: toStr(values.submitted_by),
      query_arrival_at: toISODate(values.query_arrival_at),
      quality_of_response: toStr(values.quality_of_response),
      customer_questions: toStr(values.customer_questions),
      query_response_at: toISODate(values.query_response_at),
      why_feature: toStr(values.why_feature),
      repeat_of_ticket_id: repeatOfTicketId,
    })) as { data?: import('../../api/tickets').Ticket } | import('../../api/tickets').Ticket
    const created =
      createRes && typeof createRes === 'object' && 'data' in createRes && createRes.data
        ? createRes.data
        : (createRes as import('../../api/tickets').Ticket)
    message.success('Support ticket created')
    if (!prefill) {
      await draftsApi.deleteSupportTicketDraft().catch(() => {})
    }
    form.resetFields()
    setAttachmentFileList([])
    setAttachmentUrl(null)
    setSimilarResult(null)
    onSuccess?.(created)
    onClose()
    window.dispatchEvent(new CustomEvent('support-ticket-created'))
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      let repeatOfTicketId: string | undefined
      if (
        similarResult &&
        similarResult.repeat_count >= 2 &&
        similarResult.has_open_repeat
      ) {
        const refs = similarResult.matches
          .filter((m) => m.is_open)
          .map((m) => m.reference_no)
          .slice(0, 5)
          .join(', ')
        const proceed = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: 'Similar open tickets already exist',
            content: `This title matches ${similarResult.repeat_count} prior ticket(s). Open: ${refs || similarResult.matches[0]?.reference_no}. Create a new ticket anyway?`,
            okText: 'Create anyway',
            cancelText: 'Review first',
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          })
        })
        if (!proceed) return
        repeatOfTicketId = similarResult.matches[0]?.id
      }
      setLoading(true)
      await createTicketFromForm(values, repeatOfTicketId)
    } catch (e: any) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      const detail = e?.response?.data?.detail ?? e?.message ?? 'Failed to create ticket'
      message.error(formatApiError(detail, 'Failed to create ticket'))
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!skipDraftSaveRef.current) {
      const values = form.getFieldsValue()
      const draftData = extractDraftData(values, attachmentUrlRef.current)
      if (Object.keys(draftData).length > 0) {
        draftsApi
          .saveSupportTicketDraft(draftData)
          .then(() => message.info('Draft saved. Available for 24 hours.'))
          .catch(() => {})
      }
    }
    if (draftSaveTimeoutRef.current) clearTimeout(draftSaveTimeoutRef.current)
    form.resetFields()
    setAttachmentFileList([])
    setAttachmentUrl(null)
    setTypeFeature(false)
    setRequestType('')
    setSimilarResult(null)
    setPreviewTicketId(null)
    setPreviewTicketType(null)
    onClose()
  }

  const handleViewSimilarTicket = (ticketId: string, ticketType: 'chore' | 'bug' | 'feature') => {
    setPreviewTicketId(ticketId)
    setPreviewTicketType(ticketType)
  }

  return (
    <>
    <Modal
      title="Add New Support Ticket"
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={loading}
      okButtonProps={{ disabled: uploading, title: uploading ? 'Wait for attachment to finish uploading' : undefined }}
      width={640}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }} onValuesChange={scheduleDraftSave}>
        <Form.Item name="company_id" label="Company Name" rules={[{ required: true, message: 'Required' }]}>
          <Select
            placeholder="Select company"
            showSearch
            optionFilterProp="label"
            filterOption={(input, opt) => (opt?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Form.Item>
        <Form.Item name="user_name" label="User Name" rules={[{ required: true, message: 'Required' }]}>
          <Input placeholder="User name" />
        </Form.Item>
        <Form.Item name="page_id" label="Page" rules={[{ required: true, message: 'Required' }]}>
          <Select
            placeholder="Select page"
            showSearch
            optionFilterProp="label"
            options={pages.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Form.Item>
        <Form.Item name="division_id" label="Division" rules={[{ required: true, message: 'Required' }]}>
          <Select
            placeholder="Select division"
            showSearch
            optionFilterProp="label"
            options={divisions.map((d) => ({ value: d.id, label: d.name }))}
            onChange={handleDivisionChange}
          />
        </Form.Item>
        {divisionOther && (
          <Form.Item name="division_other" label="If Other, specify">
            <Input placeholder="Specify division" />
          </Form.Item>
        )}
        <Form.Item name="title" label="Title" rules={[{ required: true, message: 'Required' }]}>
          <Input placeholder="Ticket title" />
        </Form.Item>
        <SimilarTicketsPanel
          result={similarResult}
          loading={similarLoading}
          scopeReady={similarScopeReady}
          scopeHint="Enter at least 6 characters in Title to search similar titles across all companies."
          onViewTicket={handleViewSimilarTicket}
        />
        <Form.Item name="attachment_url" label="Attachment (Optional)" hidden>
          <Input type="hidden" />
        </Form.Item>
        <Form.Item label="Attachment (Optional)">
          <Dragger
            name="attachment"
            multiple={false}
            fileList={attachmentFileList}
            showUploadList={{ showRemoveIcon: true }}
            maxCount={1}
            beforeUpload={(file) => {
              const isLt10M = file.size / 1024 / 1024 < 10
              if (!isLt10M) {
                message.error('File must be smaller than 10 MB')
                return Upload.LIST_IGNORE
              }
              setUploading(true)
              uploadAttachment(file)
                .then((res) => {
                  const raw = res?.url ?? (res as any)?.data?.url
                  const url = typeof raw === 'string' && raw.startsWith('http') ? raw : null
                  if (!url) {
                    message.error('Upload succeeded but no URL returned. Try again.')
                    return
                  }
                  setAttachmentUrl(url)
                  form.setFieldValue('attachment_url', url)
                  setAttachmentFileList([{ uid: url, name: file.name, url }])
                  message.success(`${file.name} uploaded`)
                  scheduleDraftSave()
                })
                .catch((err: any) => {
                  const detail =
                    err.response?.data?.detail ??
                    err.message ??
                    'Upload failed. Ensure backend is running and bucket "ticket-attachments" exists in Supabase.'
                  message.error(formatApiError(detail, 'Upload failed'))
                })
                .finally(() => setUploading(false))
              return false
            }}
            onRemove={() => {
              setAttachmentFileList([])
              setAttachmentUrl(null)
              form.setFieldValue('attachment_url', undefined)
              scheduleDraftSave()
            }}
            accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.txt,.doc,.docx,.xls,.xlsx"
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined style={{ color: '#1890ff' }} />
            </p>
            <p className="ant-upload-text">Click or drag file to upload (PDF, images, Word, Excel, text). Max 10 MB.</p>
          </Dragger>
        </Form.Item>
        <Form.Item name="description" label="Description (Optional)">
          <TextArea rows={3} placeholder="Additional details (not required)" />
        </Form.Item>
        <Form.Item name="type_of_request" label="Type of Request" rules={[{ required: true, message: 'Required' }]}>
          <Select
            placeholder="Select type"
            options={[
              { value: 'chore', label: 'Chores' },
              { value: 'bug', label: 'Bug' },
              { value: 'feature', label: 'Feature' },
            ]}
            onChange={handleTypeChange}
          />
        </Form.Item>
        <Form.Item name="communicated_through" label="CT" rules={[{ required: true, message: 'Required' }]}>
          <Select
            placeholder="Select"
            options={[
              { value: 'phone', label: 'Phone' },
              { value: 'mail', label: 'Mail' },
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'mom', label: 'MOM' },
            ]}
          />
        </Form.Item>
        <Form.Item name="submitted_by" label="Submitted By" rules={[{ required: true, message: 'Required' }]}>
          <Input placeholder="Auto-filled from logged-in user" readOnly />
        </Form.Item>
        <Form.Item name="query_arrival_at" label="Query Arrival Date & Time" rules={[{ required: true, message: 'Required' }]}>
          <DatePicker
            showTime={{ format: 'hh:mm A', use12Hours: true }}
            format="YYYY-MM-DD hh:mm A"
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item name="customer_questions" label="Customer Questions" rules={[{ required: true, message: 'Required' }]}>
          <TextArea rows={2} placeholder="Customer questions" />
        </Form.Item>
        <Form.Item name="quality_of_response" label="Quality of Response" rules={[{ required: true, message: 'Required' }]}>
          <Input placeholder="Quality of response" />
        </Form.Item>
        <Form.Item name="query_response_at" label="Query Response Date & Time" rules={[{ required: true, message: 'Required' }]}>
          <DatePicker
            showTime={{ format: 'hh:mm A', use12Hours: true }}
            format="YYYY-MM-DD hh:mm A"
            style={{ width: '100%' }}
          />
        </Form.Item>
        {showPriorityField && (
          <Form.Item name="priority" label="Priority" rules={[{ required: true, message: 'Required' }]}>
            <Select placeholder="Select priority" options={[...TICKET_PRIORITY_OPTIONS]} />
          </Form.Item>
        )}
        {typeFeature && (
          <Form.Item name="why_feature" label="Why Feature?" rules={[{ required: true, message: 'Required' }]}>
            <TextArea rows={2} placeholder="Why feature?" />
          </Form.Item>
        )}
      </Form>
    </Modal>
    {previewTicketType === 'feature' ? (
      <TicketDetailDrawer
        ticketId={previewTicketId}
        open={!!previewTicketId}
        onClose={() => {
          setPreviewTicketId(null)
          setPreviewTicketType(null)
        }}
        readOnly
      />
    ) : (
      <ChoresBugsDetailDrawer
        ticketId={previewTicketId}
        open={!!previewTicketId && !!previewTicketType}
        onClose={() => {
          setPreviewTicketId(null)
          setPreviewTicketType(null)
        }}
        readOnly
      />
    )}
    </>
  )
}
