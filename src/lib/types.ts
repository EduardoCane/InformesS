export interface Inspection {
  id: string;
  user_id: string;
  contract_type: string;
  template_id?: string | null;
  format_id?: string | null;
  title?: string | null;
  area: string | null;
  location: string | null;
  specific_site: string | null;
  inspection_date: string | null;
  recipient_name?: string | null;
  recipient_title?: string | null;
  sender_name?: string | null;
  sender_title?: string | null;
  subject?: string | null;
  personnel_in_charge: string | null;
  accompanying_committee: string | null;
  dynamic_fields: Record<string, unknown>;
  status: string;
  result: string | null;
  archived?: boolean;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Evidence {
  id: string;
  inspection_id: string;
  image_data: string | null;
  image_url: string | null;
  field_id: string | null;
  block_index: number | null;
  created_at: string;
}
