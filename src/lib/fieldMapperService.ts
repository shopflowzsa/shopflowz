import { supabase, supabaseServiceRole } from '@/lib/supabase';
import { CustomFieldDefinition } from '@/types/crm';

export interface LineItemTemplateConfig {
  id: string;
  label: string;
  serviceTemplate: string;
  descriptionTemplate: string;
  rateFieldId: string;
  quantityFieldId: string;
  defaultQuantity: number;
  defaultRate: number;
}

export interface FieldMapping {
  customerNameFieldId: string;
  customerPhoneFieldId: string;
  customerEmailFieldId: string;
  jobReferenceFieldId: string;
  depositFieldId: string;
  lineItemTemplates: LineItemTemplateConfig[];
}

export const DEFAULT_FIELD_MAPPING: FieldMapping = {
  customerNameFieldId: '',
  customerPhoneFieldId: '',
  customerEmailFieldId: '',
  jobReferenceFieldId: '',
  depositFieldId: '',
  lineItemTemplates: [],
};

export async function loadFieldMapping(workspaceId: string): Promise<FieldMapping> {
  try {
    const { data: row } = await supabase.from('workspace_settings').select('data').eq('workspace_id', workspaceId).eq('category', 'field_mapping').maybeSingle();
    if (row?.data) {
      const saved = row.data as any;
      return { ...DEFAULT_FIELD_MAPPING, ...saved, lineItemTemplates: saved.lineItemTemplates ?? [] } as FieldMapping;
    }
    return DEFAULT_FIELD_MAPPING;
  } catch (err) {
    console.error('Error loading field mapping:', err);
    return DEFAULT_FIELD_MAPPING;
  }
}

export async function saveFieldMapping(workspaceId: string, mapping: FieldMapping): Promise<void> {
  try {
    await supabaseServiceRole.from('workspace_settings').upsert({ workspace_id: workspaceId, category: 'field_mapping', data: mapping }, { onConflict: 'workspace_id,category' });
  } catch (err) {
    console.error('Error saving field mapping:', err);
    throw err;
  }
}

export function resolveTemplate(template: string, customFieldValues: { fieldId: string; value: unknown }[], customFields: CustomFieldDefinition[]): string {
  return template.replace(/\{([^}]+)\}/g, (_, fieldName: string) => {
    const field = customFields.find(cf => cf.name.toLowerCase().trim() === fieldName.toLowerCase().trim());
    if (!field) return '';
    const val = customFieldValues.find(cfv => cfv.fieldId === field.id);
    return val?.value != null ? String(val.value) : '';
  });
}

export function resolveField(customFieldValues: { fieldId: string; value: unknown }[], fieldId: string, fallback?: (v: { fieldId: string; value: unknown }) => boolean): string {
  if (fieldId) {
    const found = customFieldValues.find(cf => cf.fieldId === fieldId);
    if (found && found.value != null) return String(found.value);
  }
  if (fallback) {
    const found = customFieldValues.find(fallback);
    if (found && found.value != null) return String(found.value);
  }
  return '';
}
