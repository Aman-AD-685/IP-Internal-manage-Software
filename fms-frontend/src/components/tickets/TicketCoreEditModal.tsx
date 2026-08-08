import { useEffect, useRef, useState } from 'react'
import { Modal, Input, Select, Space, Typography, DatePicker, Upload, message } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { ticketsApi } from '../../api/tickets'
import type { Ticket } from '../../api/tickets'
import { supportApi, type Company, type Division, type Page } from '../../api/support'
import { uploadAttachment } from '../../api/upload'
import { splitAttachmentUrls } from '../../utils/helpers'

const { TextArea } = Input
const { Text } = Typography
const { Dragger } = Upload

interface TicketCoreEditModalProps {
  ticket: Ticket | null
  open: boolean
  onClose: () => void
  /** Called with the refreshed ticket after a successful save */
  onSaved: (fresh: Ticket | null) => void
}

interface EditFormState {
  title: string
  description: string
  company_id: string
  page_id: string
  division_id: string
  division_other: string
  user_name: string
  communicated_through: string
  submitted_by: string
  quality_of_response: string
  customer_questions: string
  query_arrival_at: string
  query_response_at: string
  why_feature: string
  attachment_url: string
}

const emptyForm: EditFormState = {
  title: '',
  description: '',
  company_id: '',
  page_id: '',
  division_id: '',
  division_other: '',
  user_name: '',
  communicated_through: '',
  submitted_by: '',
  quality_of_response: '',
  customer_questions: '',
  query_arrival_at: '',
  query_response_at: '',
  why_feature: '',
  attachment_url: '',
}

function unwrapTicket(res: unknown): Ticket | null {
  if (res && typeof res === 'object' && 'data' in res && res.data && typeof res.data === 'object' && 'id' in res.data) {
    return res.data as Ticket
  }
  if (res && typeof res === 'object' && 'id' in res) return res as Ticket
  return null
}

/**
 * Edit the support-form fields of a ticket (company, division, page, title,
 * description, attachment, …). The ticket creator can edit until the work stage
 * completes (Chores & Bugs "Stage 2" / Feature "Stage 1" — both `status_2`).
 */
export const TicketCoreEditModal = ({ ticket, open, onClose, onSaved }: TicketCoreEditModalProps) => {
  const [form, setForm] = useState<EditFormState>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [pages, setPages] = useState<Page[]>([])
  const [divisions, setDivisions] = useState<Division[]>([])
  const [attachmentFileList, setAttachmentFileList] = useState<{ uid: string; name: string; url?: string }[]>([])
  /** Concurrent uploads counter — Save stays disabled until every file finished */
  const pendingUploadsRef = useRef(0)

  // Multi-attachment: the file list is the source of truth; attachment_url stores
  // the URLs newline-joined (tickets.attachment_url is TEXT, one URL per line).
  useEffect(() => {
    const joined = attachmentFileList.map((f) => f.url).filter(Boolean).join('\n')
    setForm((p) => (p.attachment_url === joined ? p : { ...p, attachment_url: joined }))
  }, [attachmentFileList])

  useEffect(() => {
    if (!open || !ticket) return
    setForm({
      title: ticket.title || '',
      description: ticket.description || '',
      company_id: ticket.company_id || '',
      page_id: ticket.page_id || '',
      division_id: ticket.division_id || '',
      division_other: ticket.division_other || '',
      user_name: ticket.user_name || '',
      communicated_through: ticket.communicated_through || '',
      submitted_by: ticket.submitted_by || '',
      quality_of_response: ticket.quality_of_response || '',
      customer_questions: ticket.customer_questions || '',
      query_arrival_at: ticket.query_arrival_at || '',
      query_response_at: ticket.query_response_at || '',
      why_feature: ticket.why_feature || '',
      attachment_url: ticket.attachment_url || '',
    })
    const urls = splitAttachmentUrls(ticket.attachment_url)
    setAttachmentFileList(
      urls.map((u, i) => ({ uid: u, name: urls.length > 1 ? `Attachment ${i + 1}` : 'Attachment', url: u }))
    )
    supportApi.getCompanies().then((rows) => setCompanies(rows || [])).catch(() => setCompanies([]))
    supportApi.getPages().then((rows) => setPages(rows || [])).catch(() => setPages([]))
    if (ticket.company_id) {
      supportApi
        .getDivisions(ticket.company_id, { bustCache: true })
        .then((rows) => setDivisions(rows || []))
        .catch(() => setDivisions([]))
    } else {
      setDivisions([])
    }
  }, [open, ticket])

  const submit = async () => {
    if (!ticket) return
    if (!form.title.trim()) return void message.error('Title is required')
    if (!form.user_name.trim()) return void message.error('User Name is required')
    if (!form.company_id) return void message.error('Company is required')
    if (!form.page_id) return void message.error('Page is required')
    if (!form.division_id) return void message.error('Division is required')
    if (!form.quality_of_response.trim()) return void message.error('Quality of Response is required')
    if (!form.customer_questions.trim()) return void message.error('Customer Questions is required')
    if (!form.query_arrival_at) return void message.error('Query Arrival Date & Time is required')
    if (!form.query_response_at) return void message.error('Query Response Date & Time is required')

    setSubmitting(true)
    try {
      await ticketsApi.update(ticket.id, {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        company_id: form.company_id,
        page_id: form.page_id,
        division_id: form.division_id,
        division_other: form.division_other.trim() || undefined,
        user_name: form.user_name.trim(),
        communicated_through: form.communicated_through || undefined,
        submitted_by: form.submitted_by.trim() || undefined,
        quality_of_response: form.quality_of_response.trim(),
        customer_questions: form.customer_questions.trim(),
        query_arrival_at: form.query_arrival_at,
        query_response_at: form.query_response_at,
        why_feature: ticket.type === 'feature' ? form.why_feature.trim() || undefined : undefined,
        // '' clears an existing attachment; undefined leaves the column untouched
        attachment_url: form.attachment_url || (ticket.attachment_url ? '' : undefined),
      })
      const fresh = unwrapTicket(await ticketsApi.get(ticket.id))
      message.success('Ticket updated')
      onSaved(fresh)
      onClose()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | string[] } } }
      const detail = err?.response?.data?.detail
      const msg = Array.isArray(detail) ? detail[0] : typeof detail === 'string' ? detail : 'Failed to update ticket'
      message.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="Edit Support Ticket"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="Save"
      confirmLoading={submitting}
      okButtonProps={{ disabled: uploading, title: uploading ? 'Wait for attachment to finish uploading' : undefined }}
      destroyOnClose
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div>
          <Text strong>Title *</Text>
          <Input
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            placeholder="Title"
          />
        </div>
        <div>
          <Text strong>Description</Text>
          <TextArea
            rows={3}
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            placeholder="Description"
          />
        </div>
        <div>
          <Text strong>Company *</Text>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: '100%' }}
            value={form.company_id || undefined}
            placeholder="Select company"
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(v) => {
              const nextCompanyId = String(v || '')
              setForm((p) => ({ ...p, company_id: nextCompanyId, division_id: '', division_other: '' }))
              if (nextCompanyId) {
                supportApi
                  .getDivisions(nextCompanyId, { bustCache: true })
                  .then((rows) => setDivisions(rows || []))
                  .catch(() => setDivisions([]))
              } else {
                setDivisions([])
              }
            }}
          />
        </div>
        <div>
          <Text strong>Page *</Text>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: '100%' }}
            value={form.page_id || undefined}
            placeholder="Select page"
            options={pages.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(v) => setForm((p) => ({ ...p, page_id: String(v || '') }))}
          />
        </div>
        <div>
          <Text strong>Division *</Text>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: '100%' }}
            value={form.division_id || undefined}
            placeholder="Select division"
            options={divisions.map((d) => ({ value: d.id, label: d.name }))}
            onChange={(v) => {
              const nextDivisionId = String(v || '')
              const selected = divisions.find((d) => d.id === nextDivisionId)
              setForm((p) => ({
                ...p,
                division_id: nextDivisionId,
                division_other: selected?.name === 'Other' ? p.division_other : '',
              }))
            }}
            disabled={!form.company_id}
          />
        </div>
        {divisions.find((d) => d.id === form.division_id)?.name === 'Other' && (
          <div>
            <Text strong>Other Division</Text>
            <Input
              value={form.division_other}
              onChange={(e) => setForm((p) => ({ ...p, division_other: e.target.value }))}
              placeholder="Specify division"
            />
          </div>
        )}
        <div>
          <Text strong>User Name *</Text>
          <Input
            value={form.user_name}
            onChange={(e) => setForm((p) => ({ ...p, user_name: e.target.value }))}
            placeholder="User Name"
          />
        </div>
        <div>
          <Text strong>CT</Text>
          <Select
            style={{ width: '100%' }}
            value={form.communicated_through || undefined}
            placeholder="Select communication type"
            options={[
              { value: 'phone', label: 'Phone' },
              { value: 'mail', label: 'Mail' },
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'mom', label: 'MOM' },
            ]}
            onChange={(v) => setForm((p) => ({ ...p, communicated_through: String(v || '') }))}
            allowClear
          />
        </div>
        <div>
          <Text strong>Submitted By</Text>
          <Input
            value={form.submitted_by}
            onChange={(e) => setForm((p) => ({ ...p, submitted_by: e.target.value }))}
            placeholder="Submitted By"
          />
        </div>
        <div>
          <Text strong>Quality of Response *</Text>
          <Input
            value={form.quality_of_response}
            onChange={(e) => setForm((p) => ({ ...p, quality_of_response: e.target.value }))}
            placeholder="Quality of Response"
          />
        </div>
        <div>
          <Text strong>Customer Questions *</Text>
          <TextArea
            rows={2}
            value={form.customer_questions}
            onChange={(e) => setForm((p) => ({ ...p, customer_questions: e.target.value }))}
            placeholder="Customer Questions"
          />
        </div>
        {ticket?.type === 'feature' && (
          <div>
            <Text strong>Why Feature?</Text>
            <TextArea
              rows={2}
              value={form.why_feature}
              onChange={(e) => setForm((p) => ({ ...p, why_feature: e.target.value }))}
              placeholder="Why feature?"
            />
          </div>
        )}
        <div>
          <Text strong>Query Arrival Date & Time *</Text>
          <DatePicker
            showTime={{ format: 'hh:mm A', use12Hours: true }}
            format="YYYY-MM-DD hh:mm A"
            style={{ width: '100%' }}
            value={form.query_arrival_at ? dayjs(form.query_arrival_at) : null}
            onChange={(d) => setForm((p) => ({ ...p, query_arrival_at: d ? d.toISOString() : '' }))}
            allowClear
          />
        </div>
        <div>
          <Text strong>Query Response Date & Time *</Text>
          <DatePicker
            showTime={{ format: 'hh:mm A', use12Hours: true }}
            format="YYYY-MM-DD hh:mm A"
            style={{ width: '100%' }}
            value={form.query_response_at ? dayjs(form.query_response_at) : null}
            onChange={(d) => setForm((p) => ({ ...p, query_response_at: d ? d.toISOString() : '' }))}
            allowClear
          />
        </div>
        <div>
          <Text strong>Attachment</Text>
          <Dragger
            name="attachment"
            multiple
            fileList={attachmentFileList}
            showUploadList={{ showRemoveIcon: true }}
            beforeUpload={(file) => {
              const isLt10M = file.size / 1024 / 1024 < 10
              if (!isLt10M) {
                message.error('File must be smaller than 10 MB')
                return Upload.LIST_IGNORE
              }
              pendingUploadsRef.current += 1
              setUploading(true)
              uploadAttachment(file)
                .then((res) => {
                  const raw = res?.url ?? (res as { data?: { url?: string } })?.data?.url
                  const url = typeof raw === 'string' && raw.startsWith('http') ? raw : null
                  if (!url) {
                    message.error('Upload succeeded but no URL returned. Try again.')
                    return
                  }
                  setAttachmentFileList((prev) =>
                    prev.some((f) => f.url === url) ? prev : [...prev, { uid: url, name: file.name, url }]
                  )
                  message.success(`${file.name} uploaded`)
                })
                .catch((err: { response?: { data?: { detail?: string } }; message?: string }) => {
                  message.error(err.response?.data?.detail || err.message || 'Upload failed')
                })
                .finally(() => {
                  pendingUploadsRef.current -= 1
                  if (pendingUploadsRef.current <= 0) setUploading(false)
                })
              return false
            }}
            onRemove={(file) => {
              setAttachmentFileList((prev) => prev.filter((f) => f.uid !== file.uid))
            }}
            accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.txt,.doc,.docx,.xls,.xlsx"
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined style={{ color: '#1890ff' }} />
            </p>
            <p className="ant-upload-text">Click or drag files to upload. Multiple files allowed, max 10 MB each.</p>
          </Dragger>
        </div>
      </Space>
    </Modal>
  )
}
