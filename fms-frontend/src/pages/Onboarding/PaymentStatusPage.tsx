import { useState, useEffect } from 'react'
import {
  Card,
  Typography,
  Form,
  Input,
  Select,
  DatePicker,
  Button,
  Table,
  message,
  Modal,
  Space,
  Drawer,
  Tag,
  Descriptions,
  Divider,
  InputNumber,
} from 'antd'
import { PlusOutlined, FormOutlined, CheckSquareOutlined, EditOutlined, CheckCircleOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { onboardingApi, type PaymentStatusRecord } from '../../api/onboarding'
import { TableWithSkeletonLoading } from '../../components/common/skeletons'
import { DEFAULT_INFINITE_CHUNK, useInfiniteScrollChunk } from '../../hooks/useInfiniteScrollChunk'
import { OperationsSectionTabs } from '../../components/common/OperationsSectionTabs'

const { Title } = Typography
const { TextArea } = Input

const PAYMENT_STATUS_OPTIONS = [
  { label: 'Done', value: 'Done' },
  { label: 'Not Done', value: 'Not Done' },
]

// Pre-Onboarding form fields (keys must match backend PRE_ONBOARDING_KEYS)
const PRE_ONBOARDING_FIELDS: { key: string; label: string; placeholder?: string }[] = [
  { key: 'total_users', label: 'Total Users', placeholder: 'e.g. 10' },
  { key: 'end_users_id', label: 'End Users ID?', placeholder: 'Yes/No or details' },
  { key: 'gate_id_needed', label: 'Gate ID Needed?', placeholder: 'Yes/No' },
  { key: 'store_users', label: 'Store Users', placeholder: 'Number or details' },
  { key: 'purchase_users', label: 'Purchase Users', placeholder: 'Number or details' },
  { key: 'training_mode', label: 'Training Mode', placeholder: 'e.g. Online/Onsite' },
  { key: 'computer_literacy', label: 'Computer Literacy', placeholder: 'e.g. Basic/Advanced' },
  { key: 'computer_available', label: 'Computer Available?', placeholder: 'Yes/No' },
  { key: 'internet_available', label: 'Internet Available?', placeholder: 'Yes/No' },
  { key: 'printer_available', label: 'Printer Available?', placeholder: 'Yes/No' },
  { key: 'inventory_volume', label: 'Inventory Volume', placeholder: 'e.g. count or range' },
  { key: 'purchase_volume', label: 'Purchase Volume', placeholder: 'e.g. PO/day' },
  { key: 'domain_email_present', label: 'Domain Email Present?', placeholder: 'Yes/No' },
  { key: 'domain_vendor_contact_shared', label: 'Domain vendor contact shared?', placeholder: 'Yes/No' },
  { key: 'cost_centre_update', label: 'Cost Centre update', placeholder: 'Details' },
  { key: 'location_update', label: 'Location update', placeholder: 'Details' },
  { key: 'current_purchase_management', label: 'Current purchase management', placeholder: 'How managed' },
]

// Pre-Onboarding Checklist form fields (keys must match backend PRE_ONBOARDING_CHECKLIST_KEYS)
type PreChecklistFieldType = 'yes_no' | 'done_not_done' | 'number' | 'now_later' | 'literacy' | 'training_flow' | 'text'

const YES_NO_OPTIONS = [
  { label: 'Yes', value: 'Yes' },
  { label: 'No', value: 'No' },
]

const DONE_NOT_DONE_OPTIONS = [
  { label: 'Done', value: 'Done' },
  { label: 'Not Done', value: 'Not Done' },
]

const NOW_LATER_OPTIONS = [
  { label: 'Now', value: 'Now' },
  { label: 'Later', value: 'Later' },
]

const COMPUTER_LITERACY_OPTIONS = [
  { label: 'Basic', value: 'Basic' },
  { label: 'Intermediate', value: 'Intermediate' },
  { label: 'Advanced', value: 'Advanced' },
]

const TRAINING_FLOW_OPTIONS = [
  { label: 'In a flow', value: 'In a flow' },
  { label: 'Store and purchase separately', value: 'Store and purchase separately' },
]

const PRE_CHECKLIST_FIELDS: { key: string; label: string; type: PreChecklistFieldType; placeholder?: string }[] = [
  { key: 'poc_collected', label: 'POC collected?', type: 'yes_no' },
  { key: 'whatsapp_group_created', label: 'WhatsApp Group created?', type: 'yes_no' },
  { key: 'owner_added_in_group', label: 'Owner is added in group?', type: 'yes_no' },
  { key: 'meeting_link_created_shared', label: 'Meeting Link Created & shared with company?', type: 'yes_no' },
  { key: 'no_of_users_store_purchase_others', label: 'No of Users (Store+Purchase+others)', type: 'number' },
  { key: 'no_of_users_will_use_software', label: 'No of Users who will use the software', type: 'number' },
  { key: 'end_users_will_use_software', label: 'End Users also will use the software?', type: 'yes_no' },
  { key: 'gate_id_needed_or_not', label: "Gate ID needed or not?", type: 'yes_no' },
  { key: 'exact_store_purchase_persons', label: 'Exact no. of Store and Purchase persons', type: 'number' },
  { key: 'training_flow_or_separately', label: 'Training will be done in a flow or store and purchase part separately?', type: 'training_flow' },
  { key: 'computer_literacy_level', label: 'Computer Literacy level?', type: 'literacy' },
  { key: 'computers_in_store', label: 'Do we have Computers in the Store/Workplace?', type: 'yes_no' },
  { key: 'internet_available_at_store', label: 'Is Internet Connection Available at Store?', type: 'yes_no' },
  { key: 'printer_available_at_store', label: 'Is Printer Available at the Store?', type: 'yes_no' },
  { key: 'inventory_volume_items', label: 'What is the inventory Volume (Number of Items)?', type: 'number' },
  { key: 'purchase_volume_po_per_day', label: 'What is the Purchase Volume? (PO / Day)', type: 'number' },
  { key: 'domain_email_present_or_not', label: 'Is Company Domain Email Present or Not?', type: 'yes_no' },
  { key: 'domain_vendor_contact_shared_if_not', label: 'If Company Domain not available — Domain Vendor contact shared with POC?', type: 'yes_no' },
  { key: 'cost_centre_updated_now_or_later', label: 'Is Cost Centre to be updated Now or Later?', type: 'now_later' },
  { key: 'location_updated_now_or_later', label: 'Is Location to be Updated Now or Later?', type: 'now_later' },
  { key: 'managing_purchase_now', label: 'How we are managing the purchase now?', type: 'text', placeholder: 'Details' },
  { key: 'quotation_comparison', label: 'Do we do Quotation Comparison?', type: 'yes_no' },
  { key: 'basic_details_org_phone_division_gst_address_master_id_company_mail_item_list', label: 'Basic details to start the onboarding (Organization name, Phone Number, Division/s, GST, Address, Master ID details, Company Mail, Item list)', type: 'text', placeholder: 'Details' },
  { key: 'days_required_for_details', label: 'How many days required to give these details?', type: 'number' },
  { key: 'send_basic_details_from_previous_point', label: 'Send basic details which we need from them for point no. Previous', type: 'done_not_done' },
  { key: 'company_folder_created_in_drive', label: 'Company folder created in drive?', type: 'yes_no' },
  { key: 'review_meeting_prepare_plan_of_action', label: 'Review the meeting and prepare a plan of action', type: 'done_not_done' },
]

function renderPreChecklistFieldInput(field: (typeof PRE_CHECKLIST_FIELDS)[number]) {
  switch (field.type) {
    case 'yes_no':
      return <Select placeholder="Yes / No" options={YES_NO_OPTIONS} getPopupContainer={() => document.body} />
    case 'done_not_done':
      return <Select placeholder="Done / Not Done" options={DONE_NOT_DONE_OPTIONS} getPopupContainer={() => document.body} />
    case 'number':
      return <InputNumber min={0} style={{ width: '100%' }} placeholder="Number" />
    case 'now_later':
      return <Select placeholder="Now / Later" options={NOW_LATER_OPTIONS} getPopupContainer={() => document.body} />
    case 'literacy':
      return <Select placeholder="Select level" options={COMPUTER_LITERACY_OPTIONS} getPopupContainer={() => document.body} />
    case 'training_flow':
      return <Select placeholder="Select training flow" options={TRAINING_FLOW_OPTIONS} getPopupContainer={() => document.body} />
    case 'text':
      return <TextArea rows={2} placeholder={field.placeholder || 'Details'} />
    default:
      return <Input placeholder={field.placeholder} />
  }
}

// POC Checklist fields (sent formats)
const POC_CHECKLIST_FIELDS: { key: string; label: string; placeholder?: string }[] = [
  {
    key: 'user_details_format',
    label: 'Sent format of user details with Name, Email, Phone number, Division access, Department access, Roles (store/purchase/etc.), Is any approver or not?',
    placeholder: 'Describe or paste format',
  },
  {
    key: 'approver_details_format',
    label: 'Sent format of Approver with Name, Email, Phone number, Division access, Department access, Roles (store/purchase/etc.)',
    placeholder: 'Describe or paste format',
  },
  {
    key: 'approvals_format',
    label: 'Sent format of Approvals (Which approvals we have in our software and what they want)',
    placeholder: 'Describe approvals format',
  },
  {
    key: 'approval_levels_format',
    label: 'Sent format of Approval Levels (For which approval they want how many levels)',
    placeholder: 'Describe levels format',
  },
  {
    key: 'indenter_details_format',
    label: 'Sent format of Indenter with Name, Phone Number, Division access',
    placeholder: 'Describe or paste format',
  },
  {
    key: 'departments_alignment_format',
    label: 'Sent format of Departments (Division and Department alignment)',
    placeholder: 'Describe or paste format',
  },
  {
    key: 'item_stock_format',
    label: 'Sent format of Item Stock with Item name, Division name, Brand name, UOM, Stock Available, Till date of available stock',
    placeholder: 'Describe or paste format',
  },
  {
    key: 'cost_centre_format',
    label: 'Sent Cost Center format with Division, Parent, Child and Grand Child',
    placeholder: 'Describe or paste format',
  },
  {
    key: 'location_format',
    label: 'Sent Location format with Division, Locations, Sub Locations and Sub of Sub Locations',
    placeholder: 'Describe or paste format',
  },
]

// POC Details fields (shown after POC Checklist submit)
const POC_DETAILS_FIELDS: { key: string; label: string; placeholder?: string }[] = [
  { key: 'details_sent', label: 'Details Sent?', placeholder: 'Yes/No' },
  { key: 'details_sent_timestamp', label: 'Details Sent Timestamp', placeholder: 'DD-MMM-YYYY HH:mm' },
  { key: 'followup1_status', label: 'Follow-up1 Status', placeholder: 'Status' },
  { key: 'followup1_timestamp', label: 'Follow-up 1 Timestamp', placeholder: 'DD-MMM-YYYY HH:mm' },
  { key: 'followup2_status', label: 'Follow-up2 Status', placeholder: 'Status' },
  { key: 'followup2_timestamp', label: 'Follow-up 2 Timestamp', placeholder: 'DD-MMM-YYYY HH:mm' },
  { key: 'followup3_status', label: 'Follow-up3 Status', placeholder: 'Status' },
  { key: 'followup3_timestamp', label: 'Follow-up 3 Timestamp', placeholder: 'DD-MMM-YYYY HH:mm' },
  { key: 'details_collected', label: 'Details Collected?', placeholder: 'Yes/No' },
  { key: 'details_collected_timestamp', label: 'Details Collected Timestamp', placeholder: 'DD-MMM-YYYY HH:mm' },
  { key: 'remarks', label: 'Remarks', placeholder: 'Optional remarks' },
]

// Details Collected Checklist (after POC Details submit). All dropdowns Done / Not Done.
const DETAILS_COLLECTED_CHECKLIST_FIELDS: { key: string; label: string }[] = [
  { key: 'collect_user_details', label: 'Collect user details' },
  { key: 'collect_approver_details', label: 'Collect Approver details' },
  { key: 'collect_confirmation_approval_system', label: 'Collect Confirmation which approval system they want to enable' },
  { key: 'collect_approval_levels_info', label: 'Collect information of approval levels (for which approval they want how many levels)' },
  { key: 'collect_indenter_details', label: 'Collect Indenter details' },
  { key: 'collect_department_details', label: 'Collect department details' },
  { key: 'collect_item_stock_details', label: 'Collect Item Stock details' },
  { key: 'collect_cost_center_details', label: 'Collect Cost Center details' },
  { key: 'collect_location_details', label: 'Collect Location details' },
]

// Item Cleaning fields (after Details Collected Checklist). Timestamp auto-generated.
const ITEM_CLEANING_FIELDS: { key: string; label: string; placeholder?: string; auto?: boolean }[] = [
  { key: 'timestamp', label: 'Timestamp', auto: true },
  { key: 'company_name', label: 'Company Name' },
  { key: 'raw_item_received', label: 'Raw Item Received?' },
  { key: 'raw_item_uploaded_in_drive', label: 'Raw Item Uploade in Drive' },
  { key: 'create_sheet_raw_item_duplicate', label: "Create a Sheet in same File named 'Raw Item duplicate'" },
  { key: 'create_sheet_raw_item_with_code', label: "Create a Sheet In same File Named 'Raw Item With Code'" },
  { key: 'create_sheet_raw_with_code_duplicate_person_name', label: "Create a sheet in same file named 'Raw with code Duplicate-Person Name'" },
  { key: 'item_cleaned_in_excel', label: 'Item Cleaned? in Excel' },
  { key: 'item_trimmed_in_excel', label: 'Item trimed in excel' },
  { key: 'proper_casing', label: 'Proper casing' },
  { key: 'formatting', label: 'Formatting' },
  { key: 'spell_check', label: 'Spell check' },
  { key: 'upload_items_in_grok', label: 'Upload items in Grok' },
  { key: 'grok_cleaned_item_put_on_raw_with_code_duplicate_person_name', label: "Grok cleaned item put on 'Raw with code Duplicate-Person Name'" },
  { key: 'review_on_item_name_check', label: 'Review on item name check' },
  { key: 'review_on_items_uom_proper_casing', label: "Review on items' UOM proper casing" },
  { key: 'review_on_item_formatting', label: 'Review on item formating' },
  { key: 'pull_all_cleaned_item_by_assigned_item_id_in_raw_with_code', label: "Pull all cleaned item by assigned item I'D in 'Raw with Code'" },
  { key: 'create_sheet_cleaned_unique_items_with_code', label: "Create a Sheet in same file name Cleaned unique items with Code" },
]

// Item Cleaning Checklist (after Item Cleaning submit). All dropdowns Done / Not Done.
const ITEM_CLEANING_CHECKLIST_FIELDS: { key: string; label: string }[] = [
  { key: 'raw_item_sent_to_rimpa', label: 'Raw Item Sent to rimpa' },
  { key: 'raw_item_uploaded_in_drive', label: 'Raw Item Uploade in Drive' },
  { key: 'create_sheet_raw_item_duplicate', label: "Create a Sheet in same File named 'Raw Item duplicate'" },
  { key: 'create_sheet_raw_item_with_code', label: "Create a Sheet In same File Named 'Raw Item With Code'" },
  { key: 'create_sheet_raw_with_code_duplicate_person_name', label: "Create a sheet in same file named 'Raw with code Duplicate-Person Name'" },
  { key: 'item_cleaned_in_excel', label: 'Item Cleaned? in Excel' },
  { key: 'item_trimmed_in_excel', label: 'Item trimed in excel' },
  { key: 'proper_casing', label: 'Proper casing' },
  { key: 'formatting', label: 'Formatting' },
  { key: 'spell_check', label: 'Spell check' },
  { key: 'upload_items_in_grok', label: 'Upload items in Grok' },
  { key: 'grok_cleaned_item_put_on_raw_with_code_duplicate_person_name', label: "Grok cleaned item put on 'Raw with code Duplicate-Person Name'" },
  { key: 'review_on_item_name_check', label: 'Review on item name check' },
  { key: 'review_on_items_uom_proper_casing', label: "Review on items' UOM proper casing" },
  { key: 'review_on_item_formatting', label: 'Review on item formating' },
  { key: 'pull_all_cleaned_item_by_assigned_item_id_in_raw_with_code', label: "Pull all cleaned item by assigned item I'D in 'Raw with Code'" },
  { key: 'create_sheet_cleaned_unique_items_with_code', label: "Create a Sheet in same file name Cleaned unique items with Code" },
  { key: 'item_list_sent_to_ayush', label: 'Item list sent to Ayush' },
]

// Org & Master ID (after Item Cleaning Checklist). Dropdowns Done/Not Done; timestamps auto when Done; Remarks text.
const ORG_MASTER_ID_FIELDS: { key: string; label: string; type: 'dropdown' | 'timestamp' | 'remarks' }[] = [
  { key: 'data_sent_to_ayush', label: 'Data Sent to Ayush?', type: 'dropdown' },
  { key: 'data_sent_to_ayush_timestamp', label: 'Timestamp (Data Sent to Ayush)', type: 'timestamp' },
  { key: 'organization_created', label: 'Organization Created?', type: 'dropdown' },
  { key: 'organization_created_timestamp', label: 'Timestamp (Organization Created)', type: 'timestamp' },
  { key: 'master_id_created', label: 'Master ID Created?', type: 'dropdown' },
  { key: 'master_id_created_timestamp', label: 'Timestamp (Master ID Created)', type: 'timestamp' },
  { key: 'item_uploaded', label: 'Item Uploaded?', type: 'dropdown' },
  { key: 'item_uploaded_timestamp', label: 'Timestamp (Item Uploaded)', type: 'timestamp' },
  { key: 'stock_uploaded', label: 'Stock Uploaded?', type: 'dropdown' },
  { key: 'stock_uploaded_timestamp', label: 'Timestamp (Stock Uploaded)', type: 'timestamp' },
  { key: 'status', label: 'Status', type: 'dropdown' },
  { key: 'remarks', label: 'Remarks', type: 'remarks' },
]

// Map timestamp field -> dropdown field that triggers auto-fill when set to Done
const ORG_MASTER_ID_TIMESTAMP_PAIRS: Record<string, string> = {
  data_sent_to_ayush_timestamp: 'data_sent_to_ayush',
  organization_created_timestamp: 'organization_created',
  master_id_created_timestamp: 'master_id_created',
  item_uploaded_timestamp: 'item_uploaded',
  stock_uploaded_timestamp: 'stock_uploaded',
}

// Org & Master Checklist (after Org & Master ID). All Done/Not Done. 48h.
const ORG_MASTER_CHECKLIST_FIELDS: { key: string; label: string }[] = [
  { key: 'company_name_proper_format', label: 'Company name with proper format' },
  { key: 'company_email', label: 'Company email' },
  { key: 'company_phone_number', label: 'Company phone number' },
  { key: 'gst_number', label: 'GST number' },
  { key: 'company_address', label: 'Company address' },
  { key: 'plant_address', label: 'Plant Address' },
  { key: 'divisions_name', label: 'Divisions name' },
  { key: 'cleaned_item', label: 'Cleaned Item' },
  { key: 'email_for_master_id', label: "Email for master I'D" },
  { key: 'phone_number_for_master_id', label: "Phone number for master I'D" },
]

// Setup Checklist (after Org & Master Checklist). All Done/Not Done. 48h.
const SETUP_CHECKLIST_FIELDS: { key: string; label: string }[] = [
  { key: 'create_all_user_with_related_data', label: 'Create all the user with related data' },
  { key: 'create_all_approvers', label: 'Create all the approvers' },
  { key: 'enable_all_required_approvals', label: 'Enable all the required approvals' },
  { key: 'enable_all_required_approval_levels', label: 'Enable all the required approval levels' },
  { key: 'create_all_indenters', label: 'Create all the Indenters' },
  { key: 'create_departments_under_required_divisions', label: 'Create departments under required divisions' },
  { key: 'sent_item_stock_to_ayush_sir', label: 'Sent Item Stock to Ayush Sir' },
  { key: 'upload_stock_as_per_requirement', label: 'Upload stock as per requirement' },
  { key: 'clean_cc_format', label: 'Clean CC format' },
  { key: 'clean_location_format', label: 'Clean Location format' },
  { key: 'upload_cc', label: 'Upload CC' },
  { key: 'upload_locations', label: 'Upload Locations' },
]

// Item & Stock Checklist (after Setup Checklist). All Done/Not Done. 48h.
const ITEM_STOCK_CHECKLIST_FIELDS: { key: string; label: string }[] = [
  { key: 'collect_org_id', label: "Collect Org. I'D" },
  { key: 'collect_item_group_id', label: "Collect Item Group I'D" },
  { key: 'collect_item_uom_id', label: "Collect Item UOM I'D" },
  { key: 'create_sheet_ids_from_ip', label: "Create sheet named 'IDs from IP'" },
  { key: 'store_all_ids_exported_in_ids_from_ip', label: "Store all kind of I'Ds exported from IP in 'IDs from IP'" },
  { key: 'create_sheet_item_import_company_name', label: "Create sheet named 'Item_Import_Company Name'" },
  { key: 'pull_data_from_item_with_stock_cleaned_unique_items', label: "Pull all the data from file 'Item with Stock_Company Name' and sheet 'cleaned unique items with code'" },
  { key: 'calculate_item_rate_against_stock_store', label: 'Calculate Item rate against stock and store' },
  { key: 'collect_warehouse_id_store_in_ids_from_ip', label: "Collect Warehouse I'D and store in 'IDs from IP'" },
  { key: 'export_item_with_ids_from_ip_store', label: "Export item with I'Ds from IP and store in 'IDs from IP'" },
  { key: 'assign_item_ids_against_item_names_stock', label: "Assign Item I'Ds against item names with stock" },
  { key: 'export_brands_with_ids_from_ip_store', label: "Export Brands with I'Ds from IP and store in 'IDs from IP'" },
  { key: 'assign_brand_ids_against_brand_names', label: "Assign Brand I'Ds against Brand names" },
  { key: 'export_location_with_ids_from_ip_store', label: "Export location with I'Ds from IP and store in 'IDs from IP'" },
  { key: 'assign_location_ids_against_location_names', label: "Assign location I'Ds against location names" },
  { key: 'concatenate_item_and_brand_ids', label: "Concatenate Item and Brand I'Ds in relative manner" },
  { key: 'prepare_make_id_from_concatenation', label: "Prepare Make I'D from above concatenation" },
  { key: 'create_file_stock_import_div_company_name', label: "Create a file named 'Stock_Import_DIV Name_Company Name'" },
  { key: 'update_file_warehouse_item_make_qty_rate_date_location', label: "Update the above file with Warehouse I'D, Item I'D, Make I'D, Qty, Rate, Date, Location I'D" },
  { key: 'check_warehouse_column_contain_blank', label: 'Check Warehouse column contain blank?' },
  { key: 'check_item_id_contain_na_or_blank', label: "Check Item I'D contain #NA or blank?" },
  { key: 'check_make_id_contain_na_or_blank', label: "Check Make I'D contain #NA or blank?" },
  { key: 'check_no_qty_zero_or_negative', label: 'Check no QTY included 0 or negative value?' },
  { key: 'check_all_rates_ge_zero', label: 'Check all rates are >= 0?' },
  { key: 'check_all_date_cells_date_format', label: 'Check all the date cells are in Date Format?' },
  { key: 'check_location_id_contain_na_or_blank', label: "Check Location I'D contain #NA or blank?" },
  { key: 'check_duplicate_in_item_id', label: "Check duplicate in Item I'D?" },
  { key: 'remove_duplicates', label: 'Remove Duplicates' },
  { key: 'upload_file_in_ip', label: 'Upload file in IP' },
]

// Final Setup (after Item & Stock Checklist). Done/Not Done except Remarks. 48h.
const FINAL_SETUP_FIELDS: { key: string; label: string; type: 'dropdown' | 'remarks' }[] = [
  { key: 'item_uploaded', label: 'Item Uploaded?', type: 'dropdown' },
  { key: 'stock_uploaded', label: 'Stock Uploaded?', type: 'dropdown' },
  { key: 'master_setup_done', label: 'Master Setup Done?', type: 'dropdown' },
  { key: 'review_completed', label: 'Review Completed?', type: 'dropdown' },
  { key: 'onboarding_setup_done', label: 'Onboarding Setup Done?', type: 'dropdown' },
  { key: 'handed_to_training', label: 'Handed to Training?', type: 'dropdown' },
  { key: 'final_status', label: 'Final Status', type: 'dropdown' },
  { key: 'remarks', label: 'Remarks', type: 'remarks' },
]

export function PaymentStatusPage() {
  const [form] = Form.useForm()
  const [preOnboardingForm] = Form.useForm()
  const [preChecklistForm] = Form.useForm()
  const [pocChecklistForm] = Form.useForm()
  const [records, setRecords] = useState<PaymentStatusRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<PaymentStatusRecord | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [preOnboardingModalOpen, setPreOnboardingModalOpen] = useState(false)
  const [preChecklistModalOpen, setPreChecklistModalOpen] = useState(false)
  const [pocChecklistModalOpen, setPocChecklistModalOpen] = useState(false)
  const [preOnboardingResult, setPreOnboardingResult] = useState<{ data: Record<string, unknown>; editable_48h: boolean } | null>(null)
  const [preChecklistResult, setPreChecklistResult] = useState<{ data: Record<string, unknown>; editable_48h: boolean } | null>(null)
  const [preOnboardingSubmitLoading, setPreOnboardingSubmitLoading] = useState(false)
  const [preChecklistSubmitLoading, setPreChecklistSubmitLoading] = useState(false)
  const [pocChecklistResult, setPocChecklistResult] = useState<{ data: Record<string, unknown>; editable_48h: boolean } | null>(null)
  const [pocChecklistSubmitLoading, setPocChecklistSubmitLoading] = useState(false)
  const [drawerPreOnboardingStatus, setDrawerPreOnboardingStatus] = useState<{ submitted: boolean; editable_48h: boolean; submitted_at?: string | null; data?: Record<string, unknown> } | null>(null)
  const [drawerPreChecklistStatus, setDrawerPreChecklistStatus] = useState<{ submitted: boolean; editable_48h: boolean; submitted_at?: string | null; data?: Record<string, unknown> } | null>(null)
  const [drawerPocChecklistStatus, setDrawerPocChecklistStatus] = useState<{ submitted: boolean; editable_48h: boolean; submitted_at?: string | null; data?: Record<string, unknown> } | null>(null)
  const [drawerPocDetailsStatus, setDrawerPocDetailsStatus] = useState<{ data?: Record<string, unknown> } | null>(null)
  const [drawerStatusLoading, setDrawerStatusLoading] = useState(false)
  const [pocDetailsModalOpen, setPocDetailsModalOpen] = useState(false)
  const [pocDetailsForm] = Form.useForm()
  const [pocDetailsSubmitLoading, setPocDetailsSubmitLoading] = useState(false)
  const [drawerDetailsCollectedChecklistStatus, setDrawerDetailsCollectedChecklistStatus] = useState<{ submitted: boolean; editable_48h: boolean; submitted_at?: string | null; data?: Record<string, unknown> } | null>(null)
  const [detailsCollectedChecklistModalOpen, setDetailsCollectedChecklistModalOpen] = useState(false)
  const [detailsCollectedChecklistForm] = Form.useForm()
  const [detailsCollectedChecklistResult, setDetailsCollectedChecklistResult] = useState<{ data: Record<string, unknown>; editable_48h: boolean } | null>(null)
  const [detailsCollectedChecklistSubmitLoading, setDetailsCollectedChecklistSubmitLoading] = useState(false)
  const [drawerItemCleaningStatus, setDrawerItemCleaningStatus] = useState<{ data?: Record<string, unknown> } | null>(null)
  const [itemCleaningModalOpen, setItemCleaningModalOpen] = useState(false)
  const [itemCleaningForm] = Form.useForm()
  const [itemCleaningSubmitLoading, setItemCleaningSubmitLoading] = useState(false)
  const [drawerItemCleaningChecklistStatus, setDrawerItemCleaningChecklistStatus] = useState<{ submitted: boolean; editable_48h: boolean; submitted_at?: string | null; data?: Record<string, unknown> } | null>(null)
  const [itemCleaningChecklistModalOpen, setItemCleaningChecklistModalOpen] = useState(false)
  const [itemCleaningChecklistForm] = Form.useForm()
  const [itemCleaningChecklistResult, setItemCleaningChecklistResult] = useState<{ data: Record<string, unknown>; editable_48h: boolean } | null>(null)
  const [itemCleaningChecklistSubmitLoading, setItemCleaningChecklistSubmitLoading] = useState(false)
  const [drawerOrgMasterIdStatus, setDrawerOrgMasterIdStatus] = useState<{ data?: Record<string, unknown> } | null>(null)
  const [orgMasterIdModalOpen, setOrgMasterIdModalOpen] = useState(false)
  const [orgMasterIdForm] = Form.useForm()
  const [orgMasterIdSubmitLoading, setOrgMasterIdSubmitLoading] = useState(false)
  const [drawerOrgMasterChecklistStatus, setDrawerOrgMasterChecklistStatus] = useState<{ submitted: boolean; editable_48h: boolean; submitted_at?: string | null; data?: Record<string, unknown> } | null>(null)
  const [orgMasterChecklistModalOpen, setOrgMasterChecklistModalOpen] = useState(false)
  const [orgMasterChecklistForm] = Form.useForm()
  const [orgMasterChecklistResult, setOrgMasterChecklistResult] = useState<{ data: Record<string, unknown>; editable_48h: boolean } | null>(null)
  const [orgMasterChecklistSubmitLoading, setOrgMasterChecklistSubmitLoading] = useState(false)
  const [drawerSetupChecklistStatus, setDrawerSetupChecklistStatus] = useState<{ submitted: boolean; editable_48h: boolean; submitted_at?: string | null; data?: Record<string, unknown> } | null>(null)
  const [setupChecklistModalOpen, setSetupChecklistModalOpen] = useState(false)
  const [setupChecklistForm] = Form.useForm()
  const [setupChecklistResult, setSetupChecklistResult] = useState<{ data: Record<string, unknown>; editable_48h: boolean } | null>(null)
  const [setupChecklistSubmitLoading, setSetupChecklistSubmitLoading] = useState(false)
  const [drawerItemStockChecklistStatus, setDrawerItemStockChecklistStatus] = useState<{ submitted: boolean; editable_48h: boolean; submitted_at?: string | null; data?: Record<string, unknown> } | null>(null)
  const [itemStockChecklistModalOpen, setItemStockChecklistModalOpen] = useState(false)
  const [itemStockChecklistForm] = Form.useForm()
  const [itemStockChecklistResult, setItemStockChecklistResult] = useState<{ data: Record<string, unknown>; editable_48h: boolean } | null>(null)
  const [itemStockChecklistSubmitLoading, setItemStockChecklistSubmitLoading] = useState(false)
  const [drawerFinalSetupStatus, setDrawerFinalSetupStatus] = useState<{ submitted: boolean; editable_48h: boolean; submitted_at?: string | null; data?: Record<string, unknown> } | null>(null)
  const [finalSetupModalOpen, setFinalSetupModalOpen] = useState(false)
  const [finalSetupForm] = Form.useForm()
  const [finalSetupResult, setFinalSetupResult] = useState<{ data: Record<string, unknown>; editable_48h: boolean } | null>(null)
  const [finalSetupSubmitLoading, setFinalSetupSubmitLoading] = useState(false)

  const loadRecords = () => {
    setLoading(true)
    onboardingApi
      .listPaymentStatus()
      .then((r) => setRecords(r.items || []))
      .catch(() => {
        setRecords([])
        message.warning('Could not load records. Ensure the database table exists.')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadRecords()
  }, [])

  const handleSubmit = () => {
    form.validateFields().then((values) => {
      setSubmitLoading(true)
      const payload = {
        company_name: (values.company_name || '').trim(),
        payment_status: values.payment_status as 'Done' | 'Not Done',
        payment_received_date: values.payment_received_date
          ? (values.payment_received_date as Dayjs).format('YYYY-MM-DD')
          : null,
        poc_name: values.poc_name ? (values.poc_name as string).trim() : null,
        poc_contact: values.poc_contact ? String(values.poc_contact).trim() : null,
        accounts_remarks: values.accounts_remarks ? (values.accounts_remarks as string).trim() : null,
      }
      onboardingApi
        .createPaymentStatus(payload)
        .then(() => {
          message.success('Payment status submitted')
          form.resetFields()
          setAddModalOpen(false)
          loadRecords()
        })
        .catch(() => message.error('Failed to submit'))
        .finally(() => setSubmitLoading(false))
    }).catch(() => {
      message.warning('Please fill all required fields (Accounts Remarks is optional)')
    })
  }

  const openAddModal = () => {
    form.resetFields()
    setAddModalOpen(true)
  }

  const handleRowClick = (record: PaymentStatusRecord) => {
    setSelectedRecord(record)
    setDrawerOpen(true)
    setPreOnboardingResult(null)
    setPreChecklistResult(null)
    setDrawerPreOnboardingStatus(null)
    setDrawerPreChecklistStatus(null)
    setDrawerPocChecklistStatus(null)
    setDrawerPocDetailsStatus(null)
    setDrawerDetailsCollectedChecklistStatus(null)
    setDrawerItemCleaningStatus(null)
    setDrawerItemCleaningChecklistStatus(null)
    setDrawerOrgMasterIdStatus(null)
    setDrawerOrgMasterChecklistStatus(null)
    setDrawerSetupChecklistStatus(null)
    setDrawerItemStockChecklistStatus(null)
    setDrawerFinalSetupStatus(null)
    if (record?.id) loadDrawerStatus(record.id)
  }

  const loadDrawerStatus = (paymentStatusId: string) => {
    setDrawerStatusLoading(true)
    Promise.all([
      onboardingApi.getPreOnboarding(paymentStatusId),
      onboardingApi.getPreOnboardingChecklist(paymentStatusId),
      onboardingApi.getPocChecklist(paymentStatusId),
      onboardingApi.getPocDetails(paymentStatusId),
      onboardingApi.getDetailsCollectedChecklist(paymentStatusId),
      onboardingApi.getItemCleaning(paymentStatusId),
      onboardingApi.getItemCleaningChecklist(paymentStatusId),
      onboardingApi.getOrgMasterId(paymentStatusId),
      onboardingApi.getOrgMasterChecklist(paymentStatusId),
      onboardingApi.getSetupChecklist(paymentStatusId),
      onboardingApi.getItemStockChecklist(paymentStatusId),
      onboardingApi.getFinalSetup(paymentStatusId),
    ])
      .then(([pre, checklist, poc, pocDetails, dcc, itemCleaning, icChecklist, orgMaster, omChecklist, setupChecklist, isChecklist, finalSetup]) => {
        const preSubmitted = !!(pre.data && Object.keys(pre.data).length > 0 && pre.submitted_at)
        const checklistSubmitted = !!(checklist.data && Object.keys(checklist.data).length > 0 && checklist.submitted_at)
        setDrawerPreOnboardingStatus({
          submitted: preSubmitted,
          editable_48h: pre.editable_48h ?? false,
          submitted_at: pre.submitted_at ?? null,
          data: pre.data && Object.keys(pre.data).length > 0 ? pre.data : undefined,
        })
        setDrawerPreChecklistStatus({
          submitted: checklistSubmitted,
          editable_48h: checklist.editable_48h ?? false,
          submitted_at: checklist.submitted_at ?? null,
          data: checklist.data && Object.keys(checklist.data).length > 0 ? checklist.data : undefined,
        })
        const pocSubmitted = !!(poc.data && Object.keys(poc.data).length > 0 && poc.submitted_at)
        setDrawerPocChecklistStatus({
          submitted: pocSubmitted,
          editable_48h: poc.editable_48h ?? false,
          submitted_at: poc.submitted_at ?? null,
          data: poc.data && Object.keys(poc.data).length > 0 ? poc.data : undefined,
        })
        const hasPocDetails = pocDetails?.data && Object.keys(pocDetails.data).length > 0
        setDrawerPocDetailsStatus({
          data: hasPocDetails ? pocDetails.data : undefined,
        })
        const dccSubmitted = !!(dcc.data && Object.keys(dcc.data).length > 0 && dcc.submitted_at)
        setDrawerDetailsCollectedChecklistStatus({
          submitted: dccSubmitted,
          editable_48h: dcc.editable_48h ?? false,
          submitted_at: dcc.submitted_at ?? null,
          data: dcc.data && Object.keys(dcc.data).length > 0 ? dcc.data : undefined,
        })
        const hasItemCleaning = itemCleaning?.data && Object.keys(itemCleaning.data).length > 0
        setDrawerItemCleaningStatus({ data: hasItemCleaning ? itemCleaning.data : undefined })
        const icChecklistSubmitted = !!(icChecklist.data && Object.keys(icChecklist.data).length > 0 && icChecklist.submitted_at)
        setDrawerItemCleaningChecklistStatus({
          submitted: icChecklistSubmitted,
          editable_48h: icChecklist.editable_48h ?? false,
          submitted_at: icChecklist.submitted_at ?? null,
          data: icChecklist.data && Object.keys(icChecklist.data).length > 0 ? icChecklist.data : undefined,
        })
        const hasOrgMasterId = orgMaster?.data && Object.keys(orgMaster.data).length > 0
        setDrawerOrgMasterIdStatus({ data: hasOrgMasterId ? orgMaster.data : undefined })
        const omcSubmitted = !!(omChecklist.data && Object.keys(omChecklist.data).length > 0 && omChecklist.submitted_at)
        setDrawerOrgMasterChecklistStatus({ submitted: omcSubmitted, editable_48h: omChecklist.editable_48h ?? false, submitted_at: omChecklist.submitted_at ?? null, data: omChecklist.data && Object.keys(omChecklist.data).length > 0 ? omChecklist.data : undefined })
        const setupSubmitted = !!(setupChecklist.data && Object.keys(setupChecklist.data).length > 0 && setupChecklist.submitted_at)
        setDrawerSetupChecklistStatus({ submitted: setupSubmitted, editable_48h: setupChecklist.editable_48h ?? false, submitted_at: setupChecklist.submitted_at ?? null, data: setupChecklist.data && Object.keys(setupChecklist.data).length > 0 ? setupChecklist.data : undefined })
        const iscSubmitted = !!(isChecklist.data && Object.keys(isChecklist.data).length > 0 && isChecklist.submitted_at)
        setDrawerItemStockChecklistStatus({ submitted: iscSubmitted, editable_48h: isChecklist.editable_48h ?? false, submitted_at: isChecklist.submitted_at ?? null, data: isChecklist.data && Object.keys(isChecklist.data).length > 0 ? isChecklist.data : undefined })
        const finalSubmitted = !!(finalSetup.data && Object.keys(finalSetup.data).length > 0 && finalSetup.submitted_at)
        setDrawerFinalSetupStatus({ submitted: finalSubmitted, editable_48h: finalSetup.editable_48h ?? false, submitted_at: finalSetup.submitted_at ?? null, data: finalSetup.data && Object.keys(finalSetup.data).length > 0 ? finalSetup.data : undefined })
      })
      .catch(() => {
        setDrawerPreOnboardingStatus({ submitted: false, editable_48h: false })
        setDrawerPreChecklistStatus({ submitted: false, editable_48h: false })
        setDrawerPocChecklistStatus({ submitted: false, editable_48h: false })
        setDrawerPocDetailsStatus(null)
        setDrawerDetailsCollectedChecklistStatus(null)
        setDrawerItemCleaningStatus(null)
        setDrawerItemCleaningChecklistStatus(null)
        setDrawerOrgMasterIdStatus(null)
        setDrawerOrgMasterChecklistStatus(null)
        setDrawerSetupChecklistStatus(null)
        setDrawerItemStockChecklistStatus(null)
        setDrawerFinalSetupStatus(null)
      })
      .finally(() => setDrawerStatusLoading(false))
  }

  const openPreOnboarding = () => {
    if (!selectedRecord?.id) return
    setPreOnboardingResult(null)
    onboardingApi
      .getPreOnboarding(selectedRecord.id)
      .then((res) => {
        if (res.data && Object.keys(res.data).length > 0) {
          const values: Record<string, unknown> = { ...res.data }
          preOnboardingForm.setFieldsValue(values)
          setPreOnboardingResult({ data: res.data, editable_48h: res.editable_48h })
        } else {
          preOnboardingForm.resetFields()
          preOnboardingForm.setFieldsValue({ timestamp: dayjs().format('DD-MMM-YYYY HH:mm') })
        }
        setPreOnboardingModalOpen(true)
      })
      .catch(() => message.error('Failed to load Pre-Onboarding'))
  }

  const openPreChecklist = () => {
    if (!selectedRecord?.id) return
    setPreChecklistResult(null)
    onboardingApi
      .getPreOnboardingChecklist(selectedRecord.id)
      .then((res) => {
        if (res.data && Object.keys(res.data).length > 0) {
          preChecklistForm.setFieldsValue(res.data)
          setPreChecklistResult({ data: res.data, editable_48h: res.editable_48h })
        } else {
          preChecklistForm.resetFields()
        }
        setPreChecklistModalOpen(true)
      })
      .catch(() => message.error('Failed to load Pre-Onboarding Checklist'))
  }

  const openPocChecklist = () => {
    if (!selectedRecord?.id) return
    setPocChecklistResult(null)
    onboardingApi
      .getPocChecklist(selectedRecord.id)
      .then((res) => {
        if (res.data && Object.keys(res.data).length > 0) {
          pocChecklistForm.setFieldsValue(res.data)
          setPocChecklistResult({ data: res.data, editable_48h: res.editable_48h })
        } else {
          pocChecklistForm.resetFields()
        }
        setPocChecklistModalOpen(true)
      })
      .catch(() => message.error('Failed to load POC Checklist'))
  }

  const submitPreOnboarding = () => {
    if (!selectedRecord?.id) return
    preOnboardingForm.validateFields().then((values) => {
      setPreOnboardingSubmitLoading(true)
      const data: Record<string, unknown> = {}
      PRE_ONBOARDING_FIELDS.forEach((f) => {
        const v = values[f.key]
        data[f.key] = v === undefined || v === null ? '' : typeof v === 'string' ? v.trim() : v
      })
      data.timestamp = data.timestamp || new Date().toISOString()
      onboardingApi
        .savePreOnboarding(selectedRecord.id, data)
        .then((res) => {
          message.success('Pre-Onboarding saved')
          setPreOnboardingResult({ data: res.data, editable_48h: res.editable_48h })
          preOnboardingForm.setFieldsValue(res.data)
          setDrawerPreOnboardingStatus({ submitted: true, editable_48h: res.editable_48h, submitted_at: res.submitted_at, data: res.data })
        })
        .catch((e: { response?: { data?: { detail?: string } } }) => {
          message.error(e?.response?.data?.detail || 'Failed to save')
        })
        .finally(() => setPreOnboardingSubmitLoading(false))
    }).catch(() => message.warning('Please fill all required fields'))
  }

  const submitPreChecklist = () => {
    if (!selectedRecord?.id) return
    preChecklistForm.validateFields().then((values) => {
      setPreChecklistSubmitLoading(true)
      const data: Record<string, unknown> = {}
      PRE_CHECKLIST_FIELDS.forEach((f) => {
        const v = values[f.key]
        data[f.key] = v === undefined || v === null ? '' : typeof v === 'string' ? v.trim() : v
      })
      onboardingApi
        .savePreOnboardingChecklist(selectedRecord.id, data)
        .then((res) => {
          message.success('Pre-Onboarding Checklist saved')
          setPreChecklistResult({ data: res.data, editable_48h: res.editable_48h })
          preChecklistForm.setFieldsValue(res.data)
          setDrawerPreChecklistStatus({ submitted: true, editable_48h: res.editable_48h, submitted_at: res.submitted_at, data: res.data })
        })
        .catch((e: { response?: { data?: { detail?: string } } }) => {
          message.error(e?.response?.data?.detail || 'Failed to save')
        })
        .finally(() => setPreChecklistSubmitLoading(false))
    }).catch(() => message.warning('Please fill all required fields'))
  }

  const submitPocChecklist = () => {
    if (!selectedRecord?.id) return
    pocChecklistForm.validateFields().then((values) => {
      setPocChecklistSubmitLoading(true)
      const data: Record<string, unknown> = {}
      POC_CHECKLIST_FIELDS.forEach((f) => {
        const v = values[f.key]
        data[f.key] = v === undefined || v === null ? '' : typeof v === 'string' ? v.trim() : v
      })
      onboardingApi
        .savePocChecklist(selectedRecord.id, data)
        .then((res) => {
          message.success('POC Checklist saved')
          setPocChecklistResult({ data: res.data, editable_48h: res.editable_48h })
          pocChecklistForm.setFieldsValue(res.data)
          setDrawerPocChecklistStatus({ submitted: true, editable_48h: res.editable_48h, submitted_at: res.submitted_at, data: res.data })
        })
        .catch((e: { response?: { data?: { detail?: string } } }) => {
          message.error(e?.response?.data?.detail || 'Failed to save')
        })
        .finally(() => setPocChecklistSubmitLoading(false))
    }).catch(() => message.warning('Please fill all required fields'))
  }

  const openPocDetails = () => {
    if (!selectedRecord?.id) return
    onboardingApi
      .getPocDetails(selectedRecord.id)
      .then((res) => {
        const data = res.data || {}
        pocDetailsForm.setFieldsValue(data)
        setPocDetailsModalOpen(true)
      })
      .catch(() => message.error('Failed to load POC Details'))
  }

  const submitPocDetails = () => {
    if (!selectedRecord?.id) return
    pocDetailsForm.validateFields().then((values) => {
      setPocDetailsSubmitLoading(true)
      const data: Record<string, unknown> = {}
      POC_DETAILS_FIELDS.forEach((f) => {
        const v = values[f.key]
        data[f.key] = v === undefined || v === null ? '' : typeof v === 'string' ? String(v).trim() : v
      })
      onboardingApi
        .savePocDetails(selectedRecord.id, data)
        .then((res) => {
          message.success('POC Details saved')
          setDrawerPocDetailsStatus({ data: res.data })
          setPocDetailsModalOpen(false)
        })
        .catch((e: { response?: { data?: { detail?: string } } }) => {
          message.error(e?.response?.data?.detail || 'Failed to save')
        })
        .finally(() => setPocDetailsSubmitLoading(false))
    }).catch(() => {})
  }

  const openDetailsCollectedChecklist = () => {
    if (!selectedRecord?.id) return
    setDetailsCollectedChecklistResult(null)
    onboardingApi
      .getDetailsCollectedChecklist(selectedRecord.id)
      .then((res) => {
        if (res.data && Object.keys(res.data).length > 0) {
          detailsCollectedChecklistForm.setFieldsValue(res.data)
          setDetailsCollectedChecklistResult({ data: res.data, editable_48h: res.editable_48h })
        } else {
          detailsCollectedChecklistForm.resetFields()
        }
        setDetailsCollectedChecklistModalOpen(true)
      })
      .catch(() => message.error('Failed to load Details Collected Checklist'))
  }

  const submitDetailsCollectedChecklist = () => {
    if (!selectedRecord?.id) return
    detailsCollectedChecklistForm.validateFields().then((values) => {
      setDetailsCollectedChecklistSubmitLoading(true)
      const data: Record<string, unknown> = {}
      DETAILS_COLLECTED_CHECKLIST_FIELDS.forEach((f) => {
        const v = values[f.key]
        data[f.key] = v === undefined || v === null ? '' : typeof v === 'string' ? String(v).trim() : v
      })
      onboardingApi
        .saveDetailsCollectedChecklist(selectedRecord.id, data)
        .then((res) => {
          message.success('Details Collected Checklist saved')
          setDetailsCollectedChecklistResult({ data: res.data, editable_48h: res.editable_48h })
          detailsCollectedChecklistForm.setFieldsValue(res.data)
          setDrawerDetailsCollectedChecklistStatus({ submitted: true, editable_48h: res.editable_48h, submitted_at: res.submitted_at, data: res.data })
        })
        .catch((e: { response?: { data?: { detail?: string } } }) => {
          message.error(e?.response?.data?.detail || 'Failed to save')
        })
        .finally(() => setDetailsCollectedChecklistSubmitLoading(false))
    }).catch(() => message.warning('Please fill all fields (Done or Not Done)'))
  }

  const openItemCleaning = () => {
    if (!selectedRecord?.id) return
    onboardingApi
      .getItemCleaning(selectedRecord.id)
      .then((res) => {
        const data = res.data || {}
        if (Object.keys(data).length > 0) {
          itemCleaningForm.setFieldsValue(data)
        } else {
          itemCleaningForm.resetFields()
          itemCleaningForm.setFieldsValue({
            timestamp: dayjs().format('DD-MMM-YYYY HH:mm'),
            company_name: selectedRecord.company_name || '',
          })
        }
        setItemCleaningModalOpen(true)
      })
      .catch(() => message.error('Failed to load Item Cleaning'))
  }

  const submitItemCleaning = () => {
    if (!selectedRecord?.id) return
    const values = itemCleaningForm.getFieldsValue()
    const data: Record<string, unknown> = {}
    ITEM_CLEANING_FIELDS.forEach((f) => {
      const v = values[f.key]
      data[f.key] = v === undefined || v === null ? '' : typeof v === 'string' ? String(v).trim() : v
    })
    if (!data.timestamp) data.timestamp = dayjs().format('DD-MMM-YYYY HH:mm')
    setItemCleaningSubmitLoading(true)
    onboardingApi
      .saveItemCleaning(selectedRecord.id, data)
      .then((res) => {
        message.success('Item Cleaning saved')
        setDrawerItemCleaningStatus({ data: res.data })
        setItemCleaningModalOpen(false)
      })
      .catch((e: { response?: { data?: { detail?: string } } }) => {
        message.error(e?.response?.data?.detail || 'Failed to save')
      })
      .finally(() => setItemCleaningSubmitLoading(false))
  }

  const openItemCleaningChecklist = () => {
    if (!selectedRecord?.id) return
    setItemCleaningChecklistResult(null)
    onboardingApi
      .getItemCleaningChecklist(selectedRecord.id)
      .then((res) => {
        if (res.data && Object.keys(res.data).length > 0) {
          itemCleaningChecklistForm.setFieldsValue(res.data)
          setItemCleaningChecklistResult({ data: res.data, editable_48h: res.editable_48h })
        } else {
          itemCleaningChecklistForm.resetFields()
        }
        setItemCleaningChecklistModalOpen(true)
      })
      .catch(() => message.error('Failed to load Item Cleaning Checklist'))
  }

  const submitItemCleaningChecklist = () => {
    if (!selectedRecord?.id) return
    itemCleaningChecklistForm.validateFields().then((values) => {
      setItemCleaningChecklistSubmitLoading(true)
      const data: Record<string, unknown> = {}
      ITEM_CLEANING_CHECKLIST_FIELDS.forEach((f) => {
        const v = values[f.key]
        data[f.key] = v === undefined || v === null ? '' : typeof v === 'string' ? String(v).trim() : v
      })
      onboardingApi
        .saveItemCleaningChecklist(selectedRecord.id, data)
        .then((res) => {
          message.success('Item Cleaning Checklist saved')
          setItemCleaningChecklistResult({ data: res.data, editable_48h: res.editable_48h })
          itemCleaningChecklistForm.setFieldsValue(res.data)
          setDrawerItemCleaningChecklistStatus({ submitted: true, editable_48h: res.editable_48h, submitted_at: res.submitted_at, data: res.data })
        })
        .catch((e: { response?: { data?: { detail?: string } } }) => {
          message.error(e?.response?.data?.detail || 'Failed to save')
        })
        .finally(() => setItemCleaningChecklistSubmitLoading(false))
    }).catch(() => message.warning('Please fill all fields (Done or Not Done)'))
  }

  const openOrgMasterId = () => {
    if (!selectedRecord?.id) return
    onboardingApi
      .getOrgMasterId(selectedRecord.id)
      .then((res) => {
        const data = res.data || {}
        if (Object.keys(data).length > 0) {
          orgMasterIdForm.setFieldsValue(data)
        } else {
          orgMasterIdForm.resetFields()
        }
        setOrgMasterIdModalOpen(true)
      })
      .catch(() => message.error('Failed to load Org & Master ID'))
  }

  const handleOrgMasterIdChange = (changedValues: Record<string, unknown>, allValues: Record<string, unknown>) => {
    const nowStr = dayjs().format('DD-MMM-YYYY HH:mm')
    const updates: Record<string, unknown> = {}
    for (const [timestampKey, dropdownKey] of Object.entries(ORG_MASTER_ID_TIMESTAMP_PAIRS)) {
      if (dropdownKey in changedValues && changedValues[dropdownKey] === 'Done' && !allValues[timestampKey]) {
        updates[timestampKey] = nowStr
      }
    }
    if (Object.keys(updates).length > 0) {
      orgMasterIdForm.setFieldsValue(updates)
    }
  }

  const submitOrgMasterId = () => {
    if (!selectedRecord?.id) return
    const values = orgMasterIdForm.getFieldsValue()
    const data: Record<string, unknown> = {}
    ORG_MASTER_ID_FIELDS.forEach((f) => {
      const v = values[f.key]
      data[f.key] = v === undefined || v === null ? '' : typeof v === 'string' ? String(v).trim() : v
    })
    setOrgMasterIdSubmitLoading(true)
    onboardingApi
      .saveOrgMasterId(selectedRecord.id, data)
      .then((res) => {
        message.success('Org & Master ID saved')
        setDrawerOrgMasterIdStatus({ data: res.data })
        setOrgMasterIdModalOpen(false)
      })
      .catch((e: { response?: { data?: { detail?: string } } }) => {
        message.error(e?.response?.data?.detail || 'Failed to save')
      })
      .finally(() => setOrgMasterIdSubmitLoading(false))
  }

  const openOrgMasterChecklist = () => {
    if (!selectedRecord?.id) return
    setOrgMasterChecklistResult(null)
    onboardingApi.getOrgMasterChecklist(selectedRecord.id).then((res) => {
      if (res.data && Object.keys(res.data).length > 0) {
        orgMasterChecklistForm.setFieldsValue(res.data)
        setOrgMasterChecklistResult({ data: res.data, editable_48h: res.editable_48h })
      } else orgMasterChecklistForm.resetFields()
      setOrgMasterChecklistModalOpen(true)
    }).catch(() => message.error('Failed to load Org & Master Checklist'))
  }
  const submitOrgMasterChecklist = () => {
    if (!selectedRecord?.id) return
    orgMasterChecklistForm.validateFields().then((values) => {
      setOrgMasterChecklistSubmitLoading(true)
      const data: Record<string, unknown> = {}
      ORG_MASTER_CHECKLIST_FIELDS.forEach((f) => { data[f.key] = values[f.key] === undefined || values[f.key] === null ? '' : String(values[f.key]).trim() })
      onboardingApi.saveOrgMasterChecklist(selectedRecord.id, data).then((res) => {
        message.success('Org & Master Checklist saved')
        setOrgMasterChecklistResult({ data: res.data, editable_48h: res.editable_48h })
        orgMasterChecklistForm.setFieldsValue(res.data)
        setDrawerOrgMasterChecklistStatus({ submitted: true, editable_48h: res.editable_48h, submitted_at: res.submitted_at, data: res.data })
      }).catch((e: { response?: { data?: { detail?: string } } }) => message.error(e?.response?.data?.detail || 'Failed to save')).finally(() => setOrgMasterChecklistSubmitLoading(false))
    }).catch(() => message.warning('Please fill all fields (Done or Not Done)'))
  }

  const openSetupChecklist = () => {
    if (!selectedRecord?.id) return
    setSetupChecklistResult(null)
    onboardingApi.getSetupChecklist(selectedRecord.id).then((res) => {
      if (res.data && Object.keys(res.data).length > 0) {
        setupChecklistForm.setFieldsValue(res.data)
        setSetupChecklistResult({ data: res.data, editable_48h: res.editable_48h })
      } else setupChecklistForm.resetFields()
      setSetupChecklistModalOpen(true)
    }).catch(() => message.error('Failed to load Setup Checklist'))
  }
  const submitSetupChecklist = () => {
    if (!selectedRecord?.id) return
    setupChecklistForm.validateFields().then((values) => {
      setSetupChecklistSubmitLoading(true)
      const data: Record<string, unknown> = {}
      SETUP_CHECKLIST_FIELDS.forEach((f) => { data[f.key] = values[f.key] === undefined || values[f.key] === null ? '' : String(values[f.key]).trim() })
      onboardingApi.saveSetupChecklist(selectedRecord.id, data).then((res) => {
        message.success('Setup Checklist saved')
        setSetupChecklistResult({ data: res.data, editable_48h: res.editable_48h })
        setupChecklistForm.setFieldsValue(res.data)
        setDrawerSetupChecklistStatus({ submitted: true, editable_48h: res.editable_48h, submitted_at: res.submitted_at, data: res.data })
      }).catch((e: { response?: { data?: { detail?: string } } }) => message.error(e?.response?.data?.detail || 'Failed to save')).finally(() => setSetupChecklistSubmitLoading(false))
    }).catch(() => message.warning('Please fill all fields (Done or Not Done)'))
  }

  const openItemStockChecklist = () => {
    if (!selectedRecord?.id) return
    setItemStockChecklistResult(null)
    onboardingApi.getItemStockChecklist(selectedRecord.id).then((res) => {
      if (res.data && Object.keys(res.data).length > 0) {
        itemStockChecklistForm.setFieldsValue(res.data)
        setItemStockChecklistResult({ data: res.data, editable_48h: res.editable_48h })
      } else itemStockChecklistForm.resetFields()
      setItemStockChecklistModalOpen(true)
    }).catch(() => message.error('Failed to load Item & Stock Checklist'))
  }
  const submitItemStockChecklist = () => {
    if (!selectedRecord?.id) return
    itemStockChecklistForm.validateFields().then((values) => {
      setItemStockChecklistSubmitLoading(true)
      const data: Record<string, unknown> = {}
      ITEM_STOCK_CHECKLIST_FIELDS.forEach((f) => { data[f.key] = values[f.key] === undefined || values[f.key] === null ? '' : String(values[f.key]).trim() })
      onboardingApi.saveItemStockChecklist(selectedRecord.id, data).then((res) => {
        message.success('Item & Stock Checklist saved')
        setItemStockChecklistResult({ data: res.data, editable_48h: res.editable_48h })
        itemStockChecklistForm.setFieldsValue(res.data)
        setDrawerItemStockChecklistStatus({ submitted: true, editable_48h: res.editable_48h, submitted_at: res.submitted_at, data: res.data })
      }).catch((e: { response?: { data?: { detail?: string } } }) => message.error(e?.response?.data?.detail || 'Failed to save')).finally(() => setItemStockChecklistSubmitLoading(false))
    }).catch(() => message.warning('Please fill all fields (Done or Not Done)'))
  }

  const openFinalSetup = () => {
    if (!selectedRecord?.id) return
    setFinalSetupResult(null)
    onboardingApi.getFinalSetup(selectedRecord.id).then((res) => {
      if (res.data && Object.keys(res.data).length > 0) {
        finalSetupForm.setFieldsValue(res.data)
        setFinalSetupResult({ data: res.data, editable_48h: res.editable_48h })
      } else finalSetupForm.resetFields()
      setFinalSetupModalOpen(true)
    }).catch(() => message.error('Failed to load Final Setup'))
  }
  const submitFinalSetup = () => {
    if (!selectedRecord?.id) return
    finalSetupForm.validateFields().then((values) => {
      setFinalSetupSubmitLoading(true)
      const data: Record<string, unknown> = {}
      FINAL_SETUP_FIELDS.forEach((f) => { data[f.key] = values[f.key] === undefined || values[f.key] === null ? '' : String(values[f.key]).trim() })
      onboardingApi.saveFinalSetup(selectedRecord.id, data).then((res) => {
        message.success('Final Setup saved')
        setFinalSetupResult({ data: res.data, editable_48h: res.editable_48h })
        finalSetupForm.setFieldsValue(res.data)
        setDrawerFinalSetupStatus({ submitted: true, editable_48h: res.editable_48h, submitted_at: res.submitted_at, data: res.data })
      }).catch((e: { response?: { data?: { detail?: string } } }) => message.error(e?.response?.data?.detail || 'Failed to save')).finally(() => setFinalSetupSubmitLoading(false))
    }).catch(() => message.warning('Please fill all fields (Done or Not Done) except Remarks'))
  }

  const handlePocDetailsChange = (changedValues: any, allValues: any) => {
    const updates: Record<string, unknown> = {}
    const nowStr = dayjs().format('DD-MMM-YYYY HH:mm')

    if ('details_sent' in changedValues && changedValues.details_sent === 'Yes' && !allValues.details_sent_timestamp) {
      updates.details_sent_timestamp = nowStr
    }
    if ('followup1_status' in changedValues && changedValues.followup1_status === 'Yes' && !allValues.followup1_timestamp) {
      updates.followup1_timestamp = nowStr
    }
    if ('followup2_status' in changedValues && changedValues.followup2_status === 'Yes' && !allValues.followup2_timestamp) {
      updates.followup2_timestamp = nowStr
    }
    if ('followup3_status' in changedValues && changedValues.followup3_status === 'Yes' && !allValues.followup3_timestamp) {
      updates.followup3_timestamp = nowStr
    }
    if ('details_collected' in changedValues && changedValues.details_collected === 'Yes' && !allValues.details_collected_timestamp) {
      updates.details_collected_timestamp = nowStr
    }

    if (Object.keys(updates).length > 0) {
      pocDetailsForm.setFieldsValue(updates)
    }
  }

  const columns = [
    {
      title: 'Reference',
      dataIndex: 'reference_no',
      key: 'reference_no',
      width: 100,
      filters: [...new Set(records.map((r) => r.reference_no).filter(Boolean))].sort().map((v) => ({ text: v, value: v })),
      onFilter: (value, record) => record.reference_no === value,
      filterSearch: true,
    },
    {
      title: <span style={{ whiteSpace: 'normal' }}>Company</span>,
      dataIndex: 'company_name',
      key: 'company_name',
      width: 180,
      ellipsis: false,
      render: (v: string | null) => <span style={{ wordBreak: 'break-word' }}>{v || '—'}</span>,
      filters: [...new Set(records.map((r) => r.company_name).filter(Boolean))].sort().map((c) => ({ text: c, value: c })),
      onFilter: (value, record) => record.company_name === value,
      filterSearch: true,
    },
    {
      title: 'Payment Status',
      dataIndex: 'payment_status',
      key: 'payment_status',
      width: 110,
      filters: [...new Set(records.map((r) => r.payment_status).filter(Boolean))].sort().map((v) => ({ text: v, value: v })),
      onFilter: (value, record) => record.payment_status === value,
      filterSearch: true,
    },
    {
      title: 'Payment Received Date',
      dataIndex: 'payment_received_date',
      key: 'payment_received_date',
      width: 150,
      render: (v: string | null) => (v ? dayjs(v).format('DD-MMM-YYYY') : '—'),
      filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => {
        const raw = (selectedKeys[0] as string | undefined) || ''
        const [startStr, endStr] = raw.split('|')
        const value: [dayjs.Dayjs | null, dayjs.Dayjs | null] = [
          startStr ? dayjs(startStr) : null,
          endStr ? dayjs(endStr) : null,
        ]
        return (
          <div style={{ padding: 8 }}>
            <DatePicker.RangePicker
              style={{ marginBottom: 8, display: 'block', width: 220 }}
              value={value}
              onChange={(vals) => {
                if (!vals || !vals[0] || !vals[1]) {
                  setSelectedKeys([])
                  return
                }
                const start = vals[0].startOf('day').toISOString()
                const end = vals[1].endOf('day').toISOString()
                setSelectedKeys([`${start}|${end}`])
              }}
              format="DD-MMM-YYYY"
            />
            <div style={{ textAlign: 'right' }}>
              <Button
                type="primary"
                size="small"
                onClick={() => confirm()}
                style={{ marginRight: 8 }}
              >
                OK
              </Button>
              <Button
                size="small"
                onClick={() => {
                  clearFilters?.()
                  confirm()
                }}
              >
                Reset
              </Button>
            </div>
          </div>
        )
      },
      onFilter: (value, record) => {
        const raw = String(value || '')
        if (!raw) return true
        if (!record.payment_received_date) return false
        const [startStr, endStr] = raw.split('|')
        const date = dayjs(record.payment_received_date)
        const start = startStr ? dayjs(startStr) : null
        const end = endStr ? dayjs(endStr) : null
        if (start && date.isBefore(start, 'day')) return false
        if (end && date.isAfter(end, 'day')) return false
        return true
      },
      filterIcon: (filtered: boolean) => (
        <span style={{ color: filtered ? '#1890ff' : undefined }}>▼</span>
      ),
    },
    {
      title: <span style={{ whiteSpace: 'normal' }}>POC</span>,
      dataIndex: 'poc_name',
      key: 'poc_name',
      width: 140,
      ellipsis: false,
      render: (v: string | null) => <span style={{ wordBreak: 'break-word' }}>{v || '—'}</span>,
      filters: [...new Set(records.map((r) => r.poc_name || '—').filter((x) => x !== null && x !== undefined))].sort().map((v) => ({ text: v, value: v })),
      onFilter: (value, record) => (record.poc_name || '—') === value,
      filterSearch: true,
    },
    {
      title: 'POC Contact',
      dataIndex: 'poc_contact',
      key: 'poc_contact',
      width: 120,
      filters: [...new Set(records.map((r) => r.poc_contact || '—').filter((x) => x !== null && x !== undefined))].sort().map((v) => ({ text: v, value: v })),
      onFilter: (value, record) => (record.poc_contact || '—') === value,
      filterSearch: true,
    },
    {
      title: <span style={{ whiteSpace: 'normal' }}>Acc Remark</span>,
      dataIndex: 'accounts_remarks',
      key: 'accounts_remarks',
      width: 180,
      ellipsis: false,
      render: (v: string | null) => (v ? <span style={{ wordBreak: 'break-word' }} title={v}>{v}</span> : '—'),
      filters: [...new Set(records.map((r) => (r.accounts_remarks || '—').toString().trim()).filter((x) => x !== ''))].sort().slice(0, 100).map((v) => ({ text: v.length > 50 ? v.slice(0, 50) + '…' : v, value: v })),
      onFilter: (value, record) => (record.accounts_remarks || '—').toString().trim() === value,
      filterSearch: true,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (v: string | null | undefined) => v || '—',
      filters: [...new Set(records.map((r) => (r.status && r.status !== '—' ? r.status : '—')).filter(Boolean))].sort().map((s) => ({ text: s, value: s })),
      onFilter: (value, record) => (record.status || '—') === value,
      filterSearch: true,
    },
    {
      title: 'Fi-DO',
      dataIndex: 'fi_do',
      key: 'fi_do',
      width: 100,
      render: (v: string | null | undefined) => v || '—',
      filters: [...new Set(records.map((r) => r.fi_do || '—').filter((x) => x !== null && x !== undefined))].sort().map((v) => ({ text: v, value: v })),
      onFilter: (value, record) => (record.fi_do || '—') === value,
      filterSearch: true,
    },
  ]

  const {
    visibleItems: visibleRecords,
    containerRef: paymentStatusTableContainerRef,
    sentinelRef: paymentStatusTableSentinelRef,
    total: totalRecords,
    visibleCount: visibleRecordCount,
    hasMore: recordsHasMore,
  } = useInfiniteScrollChunk({ items: records, chunkSize: DEFAULT_INFINITE_CHUNK, loading })

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} wrap>
        <Space wrap align="center">
          <Title level={4} className="page-main-heading" style={{ margin: 0 }}>
            Payment Status
          </Title>
          <OperationsSectionTabs module="onboarding" />
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal}>
          Add Payment Status
        </Button>
      </Space>

      <Modal
        title="Add Payment Status"
        open={addModalOpen}
        onCancel={() => setAddModalOpen(false)}
        footer={null}
        destroyOnClose
        width={520}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="company_name"
            label="Company Name"
            rules={[{ required: true, message: 'Company Name is required' }]}
          >
            <Input placeholder="Enter company name" />
          </Form.Item>

          <Form.Item
            name="payment_status"
            label="Payment Status"
            rules={[{ required: true }]}
          >
            <Select
              placeholder="Select Done or Not Done"
              options={PAYMENT_STATUS_OPTIONS}
              allowClear={false}
            />
          </Form.Item>

          <Form.Item
            name="payment_received_date"
            label="Payment Received Date"
            rules={[{ required: true, message: 'Payment Received Date is required' }]}
          >
            <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
          </Form.Item>

          <Form.Item
            name="poc_name"
            label="POC Name"
            rules={[{ required: true, message: 'POC Name is required' }]}
          >
            <Input placeholder="POC Name" />
          </Form.Item>

          <Form.Item
            name="poc_contact"
            label="POC Contact (10 digits)"
            rules={[
              { required: true, message: 'POC Contact is required' },
              {
                validator: (_, value) => {
                  if (/^\d{10}$/.test(String(value || '').trim())) return Promise.resolve()
                  return Promise.reject(new Error('Must be exactly 10 digits'))
                },
              },
            ]}
          >
            <Input placeholder="10 digit contact number" maxLength={10} />
          </Form.Item>

          <Form.Item name="accounts_remarks" label="Accounts Remarks">
            <TextArea rows={4} placeholder="Long text" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={submitLoading}>
                Submit
              </Button>
              <Button onClick={() => setAddModalOpen(false)}>Cancel</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={selectedRecord ? `${selectedRecord.reference_no} – ${selectedRecord.company_name}` : 'Record'}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedRecord(null); setDrawerPreOnboardingStatus(null); setDrawerPreChecklistStatus(null); setDrawerPocChecklistStatus(null); setDrawerPocDetailsStatus(null); setDrawerDetailsCollectedChecklistStatus(null); setDrawerItemCleaningStatus(null); setDrawerItemCleaningChecklistStatus(null); setDrawerOrgMasterIdStatus(null); setDrawerOrgMasterChecklistStatus(null); setDrawerSetupChecklistStatus(null); setDrawerItemStockChecklistStatus(null); setDrawerFinalSetupStatus(null) }}
        width={520}
      >
        {selectedRecord && (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Reference No">{selectedRecord.reference_no}</Descriptions.Item>
              <Descriptions.Item label="Company Name">{selectedRecord.company_name}</Descriptions.Item>
              <Descriptions.Item label="Payment Status">{selectedRecord.payment_status}</Descriptions.Item>
              <Descriptions.Item label="Payment Received Date">
                {selectedRecord.payment_received_date ? dayjs(selectedRecord.payment_received_date).format('DD-MMM-YYYY') : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="POC Name">{selectedRecord.poc_name || '—'}</Descriptions.Item>
              <Descriptions.Item label="POC Contact">{selectedRecord.poc_contact || '—'}</Descriptions.Item>
            </Descriptions>
            <Divider>Pre-Onboarding & Checklist</Divider>
            {drawerStatusLoading ? (
              <div style={{ padding: 8, color: '#888' }}>Loading…</div>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {drawerPreOnboardingStatus?.submitted ? (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      <Space>
                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        <span>Pre-Onboarding</span>
                        {drawerPreOnboardingStatus.submitted_at && (
                          <span style={{ color: '#888', fontSize: 12 }}>
                            {dayjs(drawerPreOnboardingStatus.submitted_at).format('DD-MMM-YYYY HH:mm')}
                          </span>
                        )}
                      </Space>
                      {drawerPreOnboardingStatus.editable_48h ? (
                        <Button type="link" size="small" icon={<EditOutlined />} onClick={openPreOnboarding}>
                          Edit
                        </Button>
                      ) : (
                        <Button type="link" size="small" onClick={openPreOnboarding}>View</Button>
                      )}
                    </div>
                    {drawerPreOnboardingStatus.data && Object.keys(drawerPreOnboardingStatus.data).length > 0 && (
                      <Descriptions column={1} size="small" bordered>
                        <Descriptions.Item label="Timestamp">
                          {drawerPreOnboardingStatus.data.timestamp
                            ? dayjs(String(drawerPreOnboardingStatus.data.timestamp)).format('DD-MMM-YYYY HH:mm')
                            : '—'}
                        </Descriptions.Item>
                        {PRE_ONBOARDING_FIELDS.map((f) => (
                          <Descriptions.Item key={f.key} label={f.label}>
                            {String(drawerPreOnboardingStatus.data![f.key] ?? '—')}
                          </Descriptions.Item>
                        ))}
                      </Descriptions>
                    )}
                  </div>
                ) : (
                  <Button type="primary" block icon={<FormOutlined />} onClick={openPreOnboarding} size="large">
                    Pre-Onboarding
                  </Button>
                )}
                {drawerPreChecklistStatus?.submitted ? (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      <Space>
                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        <span>Pre-Onboarding Checklist</span>
                        {drawerPreChecklistStatus.submitted_at && (
                          <span style={{ color: '#888', fontSize: 12 }}>
                            {dayjs(drawerPreChecklistStatus.submitted_at).format('DD-MMM-YYYY HH:mm')}
                          </span>
                        )}
                      </Space>
                      {drawerPreChecklistStatus.editable_48h ? (
                        <Button type="link" size="small" icon={<EditOutlined />} onClick={openPreChecklist}>
                          Edit
                        </Button>
                      ) : (
                        <Button type="link" size="small" onClick={openPreChecklist}>View</Button>
                      )}
                    </div>
                    {drawerPreChecklistStatus.data && Object.keys(drawerPreChecklistStatus.data).length > 0 && (
                      <div style={{ maxHeight: 320, overflow: 'auto' }}>
                        <Descriptions column={1} size="small" bordered>
                          {PRE_CHECKLIST_FIELDS.map((f) => (
                            <Descriptions.Item key={f.key} label={f.label}>
                              {String(drawerPreChecklistStatus.data![f.key] ?? '—')}
                            </Descriptions.Item>
                          ))}
                        </Descriptions>
                      </div>
                    )}
                  </div>
                ) : (
                  <Button type="primary" block icon={<CheckSquareOutlined />} onClick={openPreChecklist} size="large">
                    Pre-Onboarding Checklist
                  </Button>
                )}
                {/* POC Checklist: only show button once Pre-Onboarding Checklist is submitted */}
                {drawerPreChecklistStatus?.submitted && (
                  drawerPocChecklistStatus?.submitted ? (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                        <Space>
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          <span>POC Checklist</span>
                          {drawerPocChecklistStatus.submitted_at && (
                            <span style={{ color: '#888', fontSize: 12 }}>
                              {dayjs(drawerPocChecklistStatus.submitted_at).format('DD-MMM-YYYY HH:mm')}
                            </span>
                          )}
                        </Space>
                        {drawerPocChecklistStatus.editable_48h ? (
                          <Button type="link" size="small" icon={<EditOutlined />} onClick={openPocChecklist}>
                            Edit
                          </Button>
                        ) : (
                          <Button type="link" size="small" onClick={openPocChecklist}>View</Button>
                        )}
                      </div>
                      {drawerPocChecklistStatus.data && Object.keys(drawerPocChecklistStatus.data).length > 0 && (
                        <div style={{ maxHeight: 320, overflow: 'auto' }}>
                          <Descriptions column={1} size="small" bordered>
                            {POC_CHECKLIST_FIELDS.map((f) => (
                              <Descriptions.Item key={f.key} label={f.label}>
                                {String(drawerPocChecklistStatus.data![f.key] ?? '—')}
                              </Descriptions.Item>
                            ))}
                          </Descriptions>
                        </div>
                      )}
                    </div>
                  ) : (
                    <Button type="primary" block onClick={openPocChecklist} size="large">
                      POC Checklist
                    </Button>
                  )
                )}
                {/* POC Details: only show after POC Checklist is submitted */}
                {drawerPocChecklistStatus?.submitted && (
                  drawerPocDetailsStatus?.data && Object.keys(drawerPocDetailsStatus.data).length > 0 ? (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                        <Space>
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          <span>POC Details</span>
                        </Space>
                        <Button type="link" size="small" icon={<EditOutlined />} onClick={openPocDetails}>
                          Edit
                        </Button>
                      </div>
                      <div style={{ maxHeight: 320, overflow: 'auto' }}>
                        <Descriptions column={1} size="small" bordered>
                          {POC_DETAILS_FIELDS.map((f) => (
                            <Descriptions.Item key={f.key} label={f.label}>
                              {String(drawerPocDetailsStatus.data![f.key] ?? '—')}
                            </Descriptions.Item>
                          ))}
                        </Descriptions>
                      </div>
                    </div>
                  ) : (
                    <Button type="default" block onClick={openPocDetails} size="large" icon={<FormOutlined />}>
                      POC Details
                    </Button>
                  )
                )}
                {/* Details Collected Checklist: only show after POC Details has data */}
                {drawerPocDetailsStatus?.data && Object.keys(drawerPocDetailsStatus.data).length > 0 && (
                  drawerDetailsCollectedChecklistStatus?.submitted ? (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                        <Space>
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          <span>Details Collected Checklist</span>
                          {drawerDetailsCollectedChecklistStatus.submitted_at && (
                            <span style={{ color: '#888', fontSize: 12 }}>
                              {dayjs(drawerDetailsCollectedChecklistStatus.submitted_at).format('DD-MMM-YYYY HH:mm')}
                            </span>
                          )}
                        </Space>
                        {drawerDetailsCollectedChecklistStatus.editable_48h ? (
                          <Button type="link" size="small" icon={<EditOutlined />} onClick={openDetailsCollectedChecklist}>
                            Edit
                          </Button>
                        ) : (
                          <Button type="link" size="small" onClick={openDetailsCollectedChecklist}>View</Button>
                        )}
                      </div>
                      {drawerDetailsCollectedChecklistStatus.data && Object.keys(drawerDetailsCollectedChecklistStatus.data).length > 0 && (
                        <div style={{ maxHeight: 320, overflow: 'auto' }}>
                          <Descriptions column={1} size="small" bordered>
                            {DETAILS_COLLECTED_CHECKLIST_FIELDS.map((f) => (
                              <Descriptions.Item key={f.key} label={f.label}>
                                {String(drawerDetailsCollectedChecklistStatus.data![f.key] ?? '—')}
                              </Descriptions.Item>
                            ))}
                          </Descriptions>
                        </div>
                      )}
                    </div>
                  ) : (
                    <Button type="primary" block onClick={openDetailsCollectedChecklist} size="large" icon={<CheckSquareOutlined />}>
                      Details Collected Checklist
                    </Button>
                  )
                )}
                {/* Item Cleaning: only show after Details Collected Checklist is submitted */}
                {drawerDetailsCollectedChecklistStatus?.submitted && (
                  drawerItemCleaningStatus?.data && Object.keys(drawerItemCleaningStatus.data).length > 0 ? (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                        <Space>
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          <span>Item Cleaning</span>
                        </Space>
                        <Button type="link" size="small" icon={<EditOutlined />} onClick={openItemCleaning}>
                          Edit
                        </Button>
                      </div>
                      <div style={{ maxHeight: 320, overflow: 'auto' }}>
                        <Descriptions column={1} size="small" bordered>
                          {ITEM_CLEANING_FIELDS.map((f) => (
                            <Descriptions.Item key={f.key} label={f.label}>
                              {String(drawerItemCleaningStatus.data![f.key] ?? '—')}
                            </Descriptions.Item>
                          ))}
                        </Descriptions>
                      </div>
                    </div>
                  ) : (
                    <Button type="default" block onClick={openItemCleaning} size="large" icon={<FormOutlined />}>
                      Item Cleaning
                    </Button>
                  )
                )}
                {/* Item Cleaning Checklist: only show after Item Cleaning has data */}
                {drawerItemCleaningStatus?.data && Object.keys(drawerItemCleaningStatus.data).length > 0 && (
                  drawerItemCleaningChecklistStatus?.submitted ? (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                        <Space>
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          <span>Item Cleaning Checklist</span>
                          {drawerItemCleaningChecklistStatus.submitted_at && (
                            <span style={{ color: '#888', fontSize: 12 }}>
                              {dayjs(drawerItemCleaningChecklistStatus.submitted_at).format('DD-MMM-YYYY HH:mm')}
                            </span>
                          )}
                        </Space>
                        {drawerItemCleaningChecklistStatus.editable_48h ? (
                          <Button type="link" size="small" icon={<EditOutlined />} onClick={openItemCleaningChecklist}>
                            Edit
                          </Button>
                        ) : (
                          <Button type="link" size="small" onClick={openItemCleaningChecklist}>View</Button>
                        )}
                      </div>
                      {drawerItemCleaningChecklistStatus.data && Object.keys(drawerItemCleaningChecklistStatus.data).length > 0 && (
                        <div style={{ maxHeight: 320, overflow: 'auto' }}>
                          <Descriptions column={1} size="small" bordered>
                            {ITEM_CLEANING_CHECKLIST_FIELDS.map((f) => (
                              <Descriptions.Item key={f.key} label={f.label}>
                                {String(drawerItemCleaningChecklistStatus.data![f.key] ?? '—')}
                              </Descriptions.Item>
                            ))}
                          </Descriptions>
                        </div>
                      )}
                    </div>
                  ) : (
                    <Button type="primary" block onClick={openItemCleaningChecklist} size="large" icon={<CheckSquareOutlined />}>
                      Item Cleaning Checklist
                    </Button>
                  )
                )}
                {/* Org & Master ID: only show after Item Cleaning Checklist is submitted */}
                {drawerItemCleaningChecklistStatus?.submitted && (
                  drawerOrgMasterIdStatus?.data && Object.keys(drawerOrgMasterIdStatus.data).length > 0 ? (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                        <Space>
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          <span>Org & Master ID</span>
                        </Space>
                        <Button type="link" size="small" icon={<EditOutlined />} onClick={openOrgMasterId}>
                          Edit
                        </Button>
                      </div>
                      <div style={{ maxHeight: 320, overflow: 'auto' }}>
                        <Descriptions column={1} size="small" bordered>
                          {ORG_MASTER_ID_FIELDS.map((f) => (
                            <Descriptions.Item key={f.key} label={f.label}>
                              {String(drawerOrgMasterIdStatus.data![f.key] ?? '—')}
                            </Descriptions.Item>
                          ))}
                        </Descriptions>
                      </div>
                    </div>
                  ) : (
                    <Button type="default" block onClick={openOrgMasterId} size="large" icon={<FormOutlined />}>
                      Org & Master ID
                    </Button>
                  )
                )}
                {/* Org & Master Checklist: after Org & Master ID has data */}
                {drawerOrgMasterIdStatus?.data && Object.keys(drawerOrgMasterIdStatus.data).length > 0 && (
                  drawerOrgMasterChecklistStatus?.submitted ? (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                        <Space>
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          <span>Org & Master Checklist</span>
                          {drawerOrgMasterChecklistStatus.submitted_at && <span style={{ color: '#888', fontSize: 12 }}>{dayjs(drawerOrgMasterChecklistStatus.submitted_at).format('DD-MMM-YYYY HH:mm')}</span>}
                        </Space>
                        {drawerOrgMasterChecklistStatus.editable_48h ? <Button type="link" size="small" icon={<EditOutlined />} onClick={openOrgMasterChecklist}>Edit</Button> : <Button type="link" size="small" onClick={openOrgMasterChecklist}>View</Button>}
                      </div>
                      {drawerOrgMasterChecklistStatus.data && Object.keys(drawerOrgMasterChecklistStatus.data).length > 0 && (
                        <div style={{ maxHeight: 320, overflow: 'auto' }}>
                          <Descriptions column={1} size="small" bordered>
                            {ORG_MASTER_CHECKLIST_FIELDS.map((f) => <Descriptions.Item key={f.key} label={f.label}>{String(drawerOrgMasterChecklistStatus.data![f.key] ?? '—')}</Descriptions.Item>)}
                          </Descriptions>
                        </div>
                      )}
                    </div>
                  ) : <Button type="primary" block onClick={openOrgMasterChecklist} size="large" icon={<CheckSquareOutlined />}>Org & Master Checklist</Button>
                )}
                {/* Setup Checklist: after Org & Master Checklist submitted */}
                {drawerOrgMasterChecklistStatus?.submitted && (
                  drawerSetupChecklistStatus?.submitted ? (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                        <Space>
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          <span>Setup Checklist</span>
                          {drawerSetupChecklistStatus.submitted_at && <span style={{ color: '#888', fontSize: 12 }}>{dayjs(drawerSetupChecklistStatus.submitted_at).format('DD-MMM-YYYY HH:mm')}</span>}
                        </Space>
                        {drawerSetupChecklistStatus.editable_48h ? <Button type="link" size="small" icon={<EditOutlined />} onClick={openSetupChecklist}>Edit</Button> : <Button type="link" size="small" onClick={openSetupChecklist}>View</Button>}
                      </div>
                      {drawerSetupChecklistStatus.data && Object.keys(drawerSetupChecklistStatus.data).length > 0 && (
                        <div style={{ maxHeight: 320, overflow: 'auto' }}>
                          <Descriptions column={1} size="small" bordered>
                            {SETUP_CHECKLIST_FIELDS.map((f) => <Descriptions.Item key={f.key} label={f.label}>{String(drawerSetupChecklistStatus.data![f.key] ?? '—')}</Descriptions.Item>)}
                          </Descriptions>
                        </div>
                      )}
                    </div>
                  ) : <Button type="primary" block onClick={openSetupChecklist} size="large" icon={<CheckSquareOutlined />}>Setup Checklist</Button>
                )}
                {/* Item & Stock Checklist: after Setup Checklist submitted */}
                {drawerSetupChecklistStatus?.submitted && (
                  drawerItemStockChecklistStatus?.submitted ? (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                        <Space>
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          <span>Item & Stock Checklist</span>
                          {drawerItemStockChecklistStatus.submitted_at && <span style={{ color: '#888', fontSize: 12 }}>{dayjs(drawerItemStockChecklistStatus.submitted_at).format('DD-MMM-YYYY HH:mm')}</span>}
                        </Space>
                        {drawerItemStockChecklistStatus.editable_48h ? <Button type="link" size="small" icon={<EditOutlined />} onClick={openItemStockChecklist}>Edit</Button> : <Button type="link" size="small" onClick={openItemStockChecklist}>View</Button>}
                      </div>
                      {drawerItemStockChecklistStatus.data && Object.keys(drawerItemStockChecklistStatus.data).length > 0 && (
                        <div style={{ maxHeight: 320, overflow: 'auto' }}>
                          <Descriptions column={1} size="small" bordered>
                            {ITEM_STOCK_CHECKLIST_FIELDS.map((f) => <Descriptions.Item key={f.key} label={f.label}>{String(drawerItemStockChecklistStatus.data![f.key] ?? '—')}</Descriptions.Item>)}
                          </Descriptions>
                        </div>
                      )}
                    </div>
                  ) : <Button type="primary" block onClick={openItemStockChecklist} size="large" icon={<CheckSquareOutlined />}>Item & Stock Checklist</Button>
                )}
                {/* Final Setup: show details whenever Final Setup is submitted; show button only after Item & Stock Checklist */}
                {(drawerItemStockChecklistStatus?.submitted || drawerFinalSetupStatus?.submitted) && (
                  drawerFinalSetupStatus?.submitted ? (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                        <Space>
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                          <span>Final Setup</span>
                          {drawerFinalSetupStatus.submitted_at && <span style={{ color: '#888', fontSize: 12 }}>{dayjs(drawerFinalSetupStatus.submitted_at).format('DD-MMM-YYYY HH:mm')}</span>}
                        </Space>
                        {drawerFinalSetupStatus.editable_48h ? <Button type="link" size="small" icon={<EditOutlined />} onClick={openFinalSetup}>Edit</Button> : <Button type="link" size="small" onClick={openFinalSetup}>View</Button>}
                      </div>
                      {drawerFinalSetupStatus.data && Object.keys(drawerFinalSetupStatus.data).length > 0 && (
                        <div style={{ maxHeight: 320, overflow: 'auto' }}>
                          <Descriptions column={1} size="small" bordered>
                            {FINAL_SETUP_FIELDS.map((f) => <Descriptions.Item key={f.key} label={f.label}>{String(drawerFinalSetupStatus.data![f.key] ?? '—')}</Descriptions.Item>)}
                          </Descriptions>
                        </div>
                      )}
                    </div>
                  ) : drawerItemStockChecklistStatus?.submitted ? <Button type="primary" block onClick={openFinalSetup} size="large" icon={<CheckSquareOutlined />}>Final Setup</Button> : null
                )}
              </Space>
            )}
          </>
        )}
      </Drawer>

      {/* Pre-Onboarding Modal */}
      <Modal
        title="Pre-Onboarding"
        open={preOnboardingModalOpen}
        onCancel={() => { setPreOnboardingModalOpen(false); setPreOnboardingResult(null) }}
        footer={null}
        width={640}
        destroyOnClose
      >
        {preOnboardingResult ? (
          <div>
            {preOnboardingResult.editable_48h && <Tag color="blue">Editable 48 hr</Tag>}
            <Descriptions column={1} size="small" bordered style={{ marginTop: 12 }}>
              <Descriptions.Item label="Timestamp">
                {preOnboardingResult.data.timestamp ? dayjs(String(preOnboardingResult.data.timestamp)).format('DD-MMM-YYYY HH:mm') : '—'}
              </Descriptions.Item>
              {PRE_ONBOARDING_FIELDS.map((f) => (
                <Descriptions.Item key={f.key} label={f.label}>
                  {String(preOnboardingResult.data[f.key] ?? '—')}
                </Descriptions.Item>
              ))}
            </Descriptions>
            <Space style={{ marginTop: 16 }}>
              {preOnboardingResult.editable_48h && (
                <Button type="primary" onClick={() => setPreOnboardingResult(null)}>Edit</Button>
              )}
              <Button onClick={() => setPreOnboardingModalOpen(false)}>Close</Button>
              <Button type="default" onClick={openPreChecklist}>Open Pre-Onboarding Checklist</Button>
            </Space>
          </div>
        ) : (
          <Form form={preOnboardingForm} layout="vertical" onFinish={submitPreOnboarding}>
            <Form.Item name="timestamp" label="Timestamp" initialValue={dayjs().format('DD-MMM-YYYY HH:mm')}>
              <Input disabled />
            </Form.Item>
            {PRE_ONBOARDING_FIELDS.map((f) => (
              <Form.Item
                key={f.key}
                name={f.key}
                label={f.label}
                rules={[{ required: true, message: `${f.label} is required` }]}
              >
                <Input placeholder={f.placeholder} />
              </Form.Item>
            ))}
            <Form.Item style={{ marginBottom: 0 }}>
              <Space>
                <Button type="primary" htmlType="submit" loading={preOnboardingSubmitLoading}>Submit</Button>
                <Button onClick={() => setPreOnboardingModalOpen(false)}>Cancel</Button>
              </Space>
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* Pre-Onboarding Checklist Modal */}
      <Modal
        title="Pre-Onboarding Checklist"
        open={preChecklistModalOpen}
        onCancel={() => { setPreChecklistModalOpen(false); setPreChecklistResult(null) }}
        footer={null}
        width={720}
        destroyOnClose
        style={{ top: 20 }}
      >
        {preChecklistResult ? (
          <div>
            {preChecklistResult.editable_48h && <Tag color="blue">Editable 48 hr</Tag>}
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              <Descriptions column={1} size="small" bordered style={{ marginTop: 12 }}>
                {PRE_CHECKLIST_FIELDS.map((f) => (
                  <Descriptions.Item key={f.key} label={f.label}>
                    {String(preChecklistResult.data[f.key] ?? '—')}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </div>
            <Space style={{ marginTop: 16 }}>
              {preChecklistResult.editable_48h && (
                <Button type="primary" onClick={() => setPreChecklistResult(null)}>Edit</Button>
              )}
              <Button onClick={() => setPreChecklistModalOpen(false)}>Close</Button>
            </Space>
          </div>
        ) : (
          <Form form={preChecklistForm} layout="vertical" onFinish={submitPreChecklist}>
            <div style={{ maxHeight: 480, overflow: 'auto', paddingRight: 4 }}>
              {PRE_CHECKLIST_FIELDS.map((f) => (
                <Form.Item
                  key={f.key}
                  name={f.key}
                  label={f.label}
                  rules={[
                    {
                      required: true,
                      message:
                        f.type === 'number'
                          ? `Enter a number for ${f.label}`
                          : f.type === 'text'
                            ? `${f.label} is required`
                            : `Select an option for ${f.label}`,
                    },
                  ]}
                >
                  {renderPreChecklistFieldInput(f)}
                </Form.Item>
              ))}
            </div>
            <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
              <Space>
                <Button type="primary" htmlType="submit" loading={preChecklistSubmitLoading}>Submit</Button>
                <Button onClick={() => setPreChecklistModalOpen(false)}>Cancel</Button>
              </Space>
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* POC Checklist Modal */}
      <Modal
        title="POC Checklist"
        open={pocChecklistModalOpen}
        onCancel={() => { setPocChecklistModalOpen(false); setPocChecklistResult(null) }}
        footer={null}
        width={640}
        destroyOnClose
        style={{ top: 40 }}
      >
        {pocChecklistResult ? (
          <div>
            {pocChecklistResult.editable_48h && <Tag color="blue">Editable 48 hr</Tag>}
            <div style={{ maxHeight: 400, overflow: 'auto', marginTop: 12 }}>
              <Descriptions column={1} size="small" bordered>
                {POC_CHECKLIST_FIELDS.map((f) => (
                  <Descriptions.Item key={f.key} label={f.label}>
                    {String(pocChecklistResult.data[f.key] ?? '—')}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </div>
            <Space style={{ marginTop: 16 }}>
              {pocChecklistResult.editable_48h && (
                <Button type="primary" onClick={() => setPocChecklistResult(null)}>Edit</Button>
              )}
              <Button onClick={() => setPocChecklistModalOpen(false)}>Close</Button>
            </Space>
          </div>
        ) : (
          <Form form={pocChecklistForm} layout="vertical" onFinish={submitPocChecklist}>
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              {POC_CHECKLIST_FIELDS.map((f) => (
                <Form.Item
                  key={f.key}
                  name={f.key}
                  label={f.label}
                  rules={[{ required: true, message: `${f.label} is required` }]}
                >
                  <TextArea rows={3} placeholder={f.placeholder} />
                </Form.Item>
              ))}
            </div>
            <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
              <Space>
                <Button type="primary" htmlType="submit" loading={pocChecklistSubmitLoading}>Submit</Button>
                <Button onClick={() => setPocChecklistModalOpen(false)}>Cancel</Button>
              </Space>
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* POC Details Modal */}
      <Modal
        title="POC Details"
        open={pocDetailsModalOpen}
        onCancel={() => setPocDetailsModalOpen(false)}
        footer={null}
        width={640}
        destroyOnClose
        style={{ top: 40 }}
      >
        <Form form={pocDetailsForm} layout="vertical" onFinish={submitPocDetails} onValuesChange={handlePocDetailsChange}>
          <div style={{ maxHeight: 440, overflow: 'auto' }}>
            {POC_DETAILS_FIELDS.map((f) => (
              <Form.Item key={f.key} name={f.key} label={f.label}>
                {['details_sent', 'followup1_status', 'followup2_status', 'followup3_status', 'details_collected'].includes(f.key) ? (
                  <Select
                    placeholder={f.placeholder || 'Select Yes or No'}
                    options={[
                      { label: 'Yes', value: 'Yes' },
                      { label: 'No', value: 'No' },
                    ]}
                  />
                ) : ['details_sent_timestamp', 'followup1_timestamp', 'followup2_timestamp', 'followup3_timestamp', 'details_collected_timestamp'].includes(f.key) ? (
                  <Input placeholder={f.placeholder} disabled />
                ) : f.key === 'remarks' ? (
                  <TextArea rows={2} placeholder={f.placeholder} />
                ) : (
                  <Input placeholder={f.placeholder} />
                )}
              </Form.Item>
            ))}
          </div>
          <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={pocDetailsSubmitLoading}>Save</Button>
              <Button onClick={() => setPocDetailsModalOpen(false)}>Cancel</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Details Collected Checklist Modal */}
      <Modal
        title="Details Collected Checklist"
        open={detailsCollectedChecklistModalOpen}
        onCancel={() => { setDetailsCollectedChecklistModalOpen(false); setDetailsCollectedChecklistResult(null) }}
        footer={null}
        width={640}
        destroyOnClose
        style={{ top: 40 }}
      >
        {detailsCollectedChecklistResult ? (
          <div>
            {detailsCollectedChecklistResult.editable_48h && <Tag color="blue">Editable 48 hr</Tag>}
            <div style={{ maxHeight: 400, overflow: 'auto', marginTop: 12 }}>
              <Descriptions column={1} size="small" bordered>
                {DETAILS_COLLECTED_CHECKLIST_FIELDS.map((f) => (
                  <Descriptions.Item key={f.key} label={f.label}>
                    {String(detailsCollectedChecklistResult.data[f.key] ?? '—')}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </div>
            <Space style={{ marginTop: 16 }}>
              {detailsCollectedChecklistResult.editable_48h && (
                <Button type="primary" onClick={() => setDetailsCollectedChecklistResult(null)}>Edit</Button>
              )}
              <Button onClick={() => setDetailsCollectedChecklistModalOpen(false)}>Close</Button>
            </Space>
          </div>
        ) : (
          <Form form={detailsCollectedChecklistForm} layout="vertical" onFinish={submitDetailsCollectedChecklist}>
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              {DETAILS_COLLECTED_CHECKLIST_FIELDS.map((f) => (
                <Form.Item
                  key={f.key}
                  name={f.key}
                  label={f.label}
                  rules={[{ required: true, message: `Select Done or Not Done for ${f.label}` }]}
                >
                  <Select placeholder="Done / Not Done" options={DONE_NOT_DONE_OPTIONS} />
                </Form.Item>
              ))}
            </div>
            <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
              <Space>
                <Button type="primary" htmlType="submit" loading={detailsCollectedChecklistSubmitLoading}>Submit</Button>
                <Button onClick={() => setDetailsCollectedChecklistModalOpen(false)}>Cancel</Button>
              </Space>
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* Item Cleaning Modal */}
      <Modal
        title="Item Cleaning"
        open={itemCleaningModalOpen}
        onCancel={() => setItemCleaningModalOpen(false)}
        footer={null}
        width={640}
        destroyOnClose
        style={{ top: 40 }}
      >
        <Form form={itemCleaningForm} layout="vertical" onFinish={submitItemCleaning}>
          <div style={{ maxHeight: 500, overflow: 'auto' }}>
            {ITEM_CLEANING_FIELDS.map((f) => (
              <Form.Item key={f.key} name={f.key} label={f.label}>
                {f.auto ? (
                  <Input disabled placeholder="Auto-generated" />
                ) : (
                  <Input placeholder={f.placeholder} />
                )}
              </Form.Item>
            ))}
          </div>
          <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={itemCleaningSubmitLoading}>Save</Button>
              <Button onClick={() => setItemCleaningModalOpen(false)}>Cancel</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Item Cleaning Checklist Modal */}
      <Modal
        title="Item Cleaning Checklist"
        open={itemCleaningChecklistModalOpen}
        onCancel={() => { setItemCleaningChecklistModalOpen(false); setItemCleaningChecklistResult(null) }}
        footer={null}
        width={640}
        destroyOnClose
        style={{ top: 40 }}
      >
        {itemCleaningChecklistResult ? (
          <div>
            {itemCleaningChecklistResult.editable_48h && <Tag color="blue">Editable 48 hr</Tag>}
            <div style={{ maxHeight: 400, overflow: 'auto', marginTop: 12 }}>
              <Descriptions column={1} size="small" bordered>
                {ITEM_CLEANING_CHECKLIST_FIELDS.map((f) => (
                  <Descriptions.Item key={f.key} label={f.label}>
                    {String(itemCleaningChecklistResult.data[f.key] ?? '—')}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </div>
            <Space style={{ marginTop: 16 }}>
              {itemCleaningChecklistResult.editable_48h && (
                <Button type="primary" onClick={() => setItemCleaningChecklistResult(null)}>Edit</Button>
              )}
              <Button onClick={() => setItemCleaningChecklistModalOpen(false)}>Close</Button>
            </Space>
          </div>
        ) : (
          <Form form={itemCleaningChecklistForm} layout="vertical" onFinish={submitItemCleaningChecklist}>
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              {ITEM_CLEANING_CHECKLIST_FIELDS.map((f) => (
                <Form.Item
                  key={f.key}
                  name={f.key}
                  label={f.label}
                  rules={[{ required: true, message: `Select Done or Not Done for ${f.label}` }]}
                >
                  <Select placeholder="Done / Not Done" options={DONE_NOT_DONE_OPTIONS} />
                </Form.Item>
              ))}
            </div>
            <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
              <Space>
                <Button type="primary" htmlType="submit" loading={itemCleaningChecklistSubmitLoading}>Submit</Button>
                <Button onClick={() => setItemCleaningChecklistModalOpen(false)}>Cancel</Button>
              </Space>
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* Org & Master ID Modal */}
      <Modal
        title="Org & Master ID"
        open={orgMasterIdModalOpen}
        onCancel={() => setOrgMasterIdModalOpen(false)}
        footer={null}
        width={640}
        destroyOnClose
        style={{ top: 40 }}
      >
        <Form form={orgMasterIdForm} layout="vertical" onFinish={submitOrgMasterId} onValuesChange={handleOrgMasterIdChange}>
          <div style={{ maxHeight: 500, overflow: 'auto' }}>
            {ORG_MASTER_ID_FIELDS.map((f) => (
              <Form.Item key={f.key} name={f.key} label={f.label}>
                {f.type === 'dropdown' ? (
                  <Select placeholder="Done / Not Done" options={DONE_NOT_DONE_OPTIONS} />
                ) : f.type === 'timestamp' ? (
                  <Input disabled placeholder="Auto-generated when Done selected" />
                ) : (
                  <TextArea rows={2} placeholder="Remarks" />
                )}
              </Form.Item>
            ))}
          </div>
          <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={orgMasterIdSubmitLoading}>Save</Button>
              <Button onClick={() => setOrgMasterIdModalOpen(false)}>Cancel</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Org & Master Checklist Modal */}
      <Modal title="Org & Master Checklist" open={orgMasterChecklistModalOpen} onCancel={() => { setOrgMasterChecklistModalOpen(false); setOrgMasterChecklistResult(null) }} footer={null} width={640} destroyOnClose style={{ top: 40 }}>
        {orgMasterChecklistResult ? (
          <div>
            {orgMasterChecklistResult.editable_48h && <Tag color="blue">Editable 48 hr</Tag>}
            <div style={{ maxHeight: 400, overflow: 'auto', marginTop: 12 }}>
              <Descriptions column={1} size="small" bordered>
                {ORG_MASTER_CHECKLIST_FIELDS.map((f) => <Descriptions.Item key={f.key} label={f.label}>{String(orgMasterChecklistResult.data[f.key] ?? '—')}</Descriptions.Item>)}
              </Descriptions>
            </div>
            <Space style={{ marginTop: 16 }}>
              {orgMasterChecklistResult.editable_48h && <Button type="primary" onClick={() => setOrgMasterChecklistResult(null)}>Edit</Button>}
              <Button onClick={() => setOrgMasterChecklistModalOpen(false)}>Close</Button>
            </Space>
          </div>
        ) : (
          <Form form={orgMasterChecklistForm} layout="vertical" onFinish={submitOrgMasterChecklist}>
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              {ORG_MASTER_CHECKLIST_FIELDS.map((f) => (
                <Form.Item key={f.key} name={f.key} label={f.label} rules={[{ required: true, message: `Select Done or Not Done` }]}>
                  <Select placeholder="Done / Not Done" options={DONE_NOT_DONE_OPTIONS} />
                </Form.Item>
              ))}
            </div>
            <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
              <Space>
                <Button type="primary" htmlType="submit" loading={orgMasterChecklistSubmitLoading}>Submit</Button>
                <Button onClick={() => setOrgMasterChecklistModalOpen(false)}>Cancel</Button>
              </Space>
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* Setup Checklist Modal */}
      <Modal title="Setup Checklist" open={setupChecklistModalOpen} onCancel={() => { setSetupChecklistModalOpen(false); setSetupChecklistResult(null) }} footer={null} width={640} destroyOnClose style={{ top: 40 }}>
        {setupChecklistResult ? (
          <div>
            {setupChecklistResult.editable_48h && <Tag color="blue">Editable 48 hr</Tag>}
            <div style={{ maxHeight: 400, overflow: 'auto', marginTop: 12 }}>
              <Descriptions column={1} size="small" bordered>
                {SETUP_CHECKLIST_FIELDS.map((f) => <Descriptions.Item key={f.key} label={f.label}>{String(setupChecklistResult.data[f.key] ?? '—')}</Descriptions.Item>)}
              </Descriptions>
            </div>
            <Space style={{ marginTop: 16 }}>
              {setupChecklistResult.editable_48h && <Button type="primary" onClick={() => setSetupChecklistResult(null)}>Edit</Button>}
              <Button onClick={() => setSetupChecklistModalOpen(false)}>Close</Button>
            </Space>
          </div>
        ) : (
          <Form form={setupChecklistForm} layout="vertical" onFinish={submitSetupChecklist}>
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              {SETUP_CHECKLIST_FIELDS.map((f) => (
                <Form.Item key={f.key} name={f.key} label={f.label} rules={[{ required: true, message: `Select Done or Not Done` }]}>
                  <Select placeholder="Done / Not Done" options={DONE_NOT_DONE_OPTIONS} />
                </Form.Item>
              ))}
            </div>
            <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
              <Space>
                <Button type="primary" htmlType="submit" loading={setupChecklistSubmitLoading}>Submit</Button>
                <Button onClick={() => setSetupChecklistModalOpen(false)}>Cancel</Button>
              </Space>
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* Item & Stock Checklist Modal */}
      <Modal title="Item & Stock Checklist" open={itemStockChecklistModalOpen} onCancel={() => { setItemStockChecklistModalOpen(false); setItemStockChecklistResult(null) }} footer={null} width={640} destroyOnClose style={{ top: 40 }}>
        {itemStockChecklistResult ? (
          <div>
            {itemStockChecklistResult.editable_48h && <Tag color="blue">Editable 48 hr</Tag>}
            <div style={{ maxHeight: 400, overflow: 'auto', marginTop: 12 }}>
              <Descriptions column={1} size="small" bordered>
                {ITEM_STOCK_CHECKLIST_FIELDS.map((f) => <Descriptions.Item key={f.key} label={f.label}>{String(itemStockChecklistResult.data[f.key] ?? '—')}</Descriptions.Item>)}
              </Descriptions>
            </div>
            <Space style={{ marginTop: 16 }}>
              {itemStockChecklistResult.editable_48h && <Button type="primary" onClick={() => setItemStockChecklistResult(null)}>Edit</Button>}
              <Button onClick={() => setItemStockChecklistModalOpen(false)}>Close</Button>
            </Space>
          </div>
        ) : (
          <Form form={itemStockChecklistForm} layout="vertical" onFinish={submitItemStockChecklist}>
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              {ITEM_STOCK_CHECKLIST_FIELDS.map((f) => (
                <Form.Item key={f.key} name={f.key} label={f.label} rules={[{ required: true, message: `Select Done or Not Done` }]}>
                  <Select placeholder="Done / Not Done" options={DONE_NOT_DONE_OPTIONS} />
                </Form.Item>
              ))}
            </div>
            <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
              <Space>
                <Button type="primary" htmlType="submit" loading={itemStockChecklistSubmitLoading}>Submit</Button>
                <Button onClick={() => setItemStockChecklistModalOpen(false)}>Cancel</Button>
              </Space>
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* Final Setup Modal */}
      <Modal title="Final Setup" open={finalSetupModalOpen} onCancel={() => { setFinalSetupModalOpen(false); setFinalSetupResult(null) }} footer={null} width={640} destroyOnClose style={{ top: 40 }}>
        {finalSetupResult ? (
          <div>
            {finalSetupResult.editable_48h && <Tag color="blue">Editable 48 hr</Tag>}
            <div style={{ maxHeight: 400, overflow: 'auto', marginTop: 12 }}>
              <Descriptions column={1} size="small" bordered>
                {FINAL_SETUP_FIELDS.map((f) => <Descriptions.Item key={f.key} label={f.label}>{String(finalSetupResult.data[f.key] ?? '—')}</Descriptions.Item>)}
              </Descriptions>
            </div>
            <Space style={{ marginTop: 16 }}>
              {finalSetupResult.editable_48h && <Button type="primary" onClick={() => setFinalSetupResult(null)}>Edit</Button>}
              <Button onClick={() => setFinalSetupModalOpen(false)}>Close</Button>
            </Space>
          </div>
        ) : (
          <Form form={finalSetupForm} layout="vertical" onFinish={submitFinalSetup}>
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              {FINAL_SETUP_FIELDS.map((f) => (
                <Form.Item key={f.key} name={f.key} label={f.label} rules={f.type === 'dropdown' ? [{ required: true, message: 'Select Done or Not Done' }] : undefined}>
                  {f.type === 'remarks' ? <TextArea rows={2} placeholder="Remarks" /> : <Select placeholder="Done / Not Done" options={DONE_NOT_DONE_OPTIONS} />}
                </Form.Item>
              ))}
            </div>
            <Form.Item style={{ marginBottom: 0, marginTop: 16 }}>
              <Space>
                <Button type="primary" htmlType="submit" loading={finalSetupSubmitLoading}>Submit</Button>
                <Button onClick={() => setFinalSetupModalOpen(false)}>Cancel</Button>
              </Space>
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Card title="Payment Status Records">
        <TableWithSkeletonLoading loading={loading} columns={10} rows={12}>
          <div ref={paymentStatusTableContainerRef}>
            <Table
              dataSource={visibleRecords}
              columns={columns}
              rowKey="id"
              virtual
              loading={false}
              scroll={{ x: 1100, y: 600 }}
              pagination={false}
              summary={() => (
                <Table.Summary>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={columns.length}>
                      <div ref={paymentStatusTableSentinelRef} style={{ height: 8, minHeight: 8 }} aria-hidden />
                      <Typography.Text type="secondary">
                        Showing {visibleRecordCount} of {totalRecords} rows{recordsHasMore ? ' · scroll to load more' : ''}
                      </Typography.Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
              onRow={(record) => ({
                onClick: () => handleRowClick(record),
                style: { cursor: 'pointer' },
              })}
            />
          </div>
        </TableWithSkeletonLoading>
      </Card>
    </div>
  )
}
