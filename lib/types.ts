/** Tipos de las filas que la aplicación lee (reflejan las migraciones SQL). */

export type Role = "super_admin" | "owner" | "auxiliar";

export interface Profile {
  id: string;
  organization_id: string | null;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  valid_until: string | null;
  max_auxiliares: number;
  storage_quota_mb: number;
  created_at: string;
}

export interface OrgSettings {
  organization_id: string;
  business_name: string;
  professional_name: string | null;
  professional_card: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  logo_file_id: string | null;
  primary_color: string;
  letterhead_text: string | null;
  data_policy_text: string | null;
  timezone: string;
  currency: string;
}

export interface Species {
  id: string;
  name: string;
  is_active: boolean;
}

export interface Breed {
  id: string;
  species_id: string;
  name: string;
  is_active: boolean;
}

export interface Tutor {
  id: string;
  full_name: string;
  document_number: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  notes: string | null;
  custom_fields: Record<string, unknown>;
  data_consent: boolean;
  data_consent_at: string | null;
  contact_consent: boolean;
  contact_consent_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Patient {
  id: string;
  tutor_id: string;
  name: string;
  species_id: string;
  breed_id: string | null;
  breed_text: string | null;
  sex: "macho" | "hembra" | "indeterminado";
  color: string | null;
  birth_date: string | null;
  birth_date_approx: boolean;
  microchip: string | null;
  sterilized: boolean | null;
  allergies: string | null;
  background: string | null;
  photo_file_id: string | null;
  status: "activo" | "fallecido";
  deceased_at: string | null;
  deceased_reason: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
}

export interface Consultation {
  id: string;
  edit_count: number;
  patient_id: string;
  kind: "consulta" | "control";
  parent_consultation_id: string | null;
  consulted_at: string;
  professional_name: string;
  reason: string | null;
  anamnesis: string | null;
  weight_kg: number | null;
  temperature_c: number | null;
  heart_rate: number | null;
  resp_rate: number | null;
  mucous_membranes: string | null;
  capillary_refill_s: number | null;
  hydration: string | null;
  body_condition: number | null;
  differential_diagnoses: string | null;
  exams_notes: string | null;
  definitive_diagnosis: string | null;
  treatment: string | null;
  recommendations: string | null;
  control_type_id: string | null;
  next_control_date: string | null;
  custom_fields: Record<string, unknown>;
  status: "borrador" | "cerrada" | "anulada";
  closed_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface Prescription {
  id: string;
  consultation_id: string;
  patient_id: string;
  number: number;
  issued_at: string;
  professional_name: string;
  notes: string | null;
}

export interface PrescriptionItem {
  id: string;
  prescription_id: string;
  medication_name: string;
  presentation: string | null;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  route: string | null;
  instructions: string | null;
  sort_order: number;
}

export interface Vaccination {
  id: string;
  patient_id: string;
  vaccine_name: string;
  applied_at: string;
  lot: string | null;
  expires_at: string | null;
  next_due_at: string | null;
  weight_kg: number | null;
  temperature_c: number | null;
  general_state: string | null;
  notes: string | null;
  applied_by_name: string | null;
  status: "aplicada" | "anulada";
  void_reason: string | null;
}

export interface Deworming {
  id: string;
  patient_id: string;
  kind: "interna" | "externa";
  product_name: string;
  applied_at: string;
  lot: string | null;
  expires_at: string | null;
  next_due_at: string | null;
  weight_kg: number | null;
  temperature_c: number | null;
  general_state: string | null;
  notes: string | null;
  applied_by_name: string | null;
  status: "aplicada" | "anulada";
  void_reason: string | null;
}

export interface Reminder {
  id: string;
  patient_id: string;
  tutor_id: string;
  kind: "vacuna" | "desparasitante" | "control";
  title: string;
  due_date: string;
  remind_from: string;
  status: "pendiente" | "enviado" | "hecho" | "descartado";
  sent_at: string | null;
}

export interface Consent {
  id: string;
  kind: "vacuna" | "anestesia" | "procedimiento" | "eutanasia" | "datos" | "otro";
  patient_id: string | null;
  tutor_id: string;
  consultation_id: string | null;
  title: string;
  body: string;
  procedure_description: string | null;
  content_hash: string | null;
  status: "pendiente" | "firmada" | "rechazada" | "anulada";
  signed_at: string | null;
  signer_name: string | null;
  signer_document: string | null;
  signature_method: "pantalla" | "archivo" | "fisico" | null;
  signature_file_id: string | null;
  upload_file_id: string | null;
  signer_ip: string | null;
  decline_reason: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface FileRow {
  id: string;
  organization_id: string;
  kind: string;
  storage_path: string;
  original_name: string | null;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  deleted_at: string | null;
}

export interface AgendaSettings {
  organization_id: string;
  slot_minutes: number;
  allow_overlap: boolean;
  reminder_template: string;
}

export interface AgendaHour {
  id: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
}

export interface AgendaBlock {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string;
}

export interface AppointmentType {
  id: string;
  name: string;
  duration_minutes: number;
  color: string | null;
  is_active: boolean;
}

export interface Appointment {
  id: string;
  patient_id: string;
  tutor_id: string;
  type_id: string | null;
  starts_at: string;
  ends_at: string;
  status: "programada" | "confirmada" | "en_sala" | "atendida" | "cancelada" | "no_asistio";
  reason: string | null;
  notes: string | null;
  consultation_id: string | null;
  cancel_reason: string | null;
  reminder_sent_at: string | null;
}

export interface WaitlistEntry {
  id: string;
  patient_id: string;
  tutor_id: string;
  type_id: string | null;
  notes: string | null;
  status: "esperando" | "agendada" | "descartada";
  created_at: string;
}
