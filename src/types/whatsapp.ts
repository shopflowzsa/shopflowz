// Which task field to use when filling a template variable
export type TaskFieldKey =
  | "title"
  | "status"
  | "priority"
  | "description"
  | "listName"
  | "createdAt"
  | "dueDate"
  | "assignee";

export const TASK_FIELD_LABELS: Record<TaskFieldKey, string> = {
  title: "Task Title",
  status: "Status",
  priority: "Priority",
  description: "Description",
  listName: "List Name",
  createdAt: "Created Date",
  dueDate: "Due Date",
  assignee: "Assignee",
};

export interface WhatsAppVariableMapping {
  variableIndex: number; // 1-based — maps to {{1}}, {{2}}, etc. in template
  fieldKey: TaskFieldKey | `custom:${string}`; // task field or custom field id
}

export interface WhatsAppTemplate {
  name: string;
  language: string;
  status: string;          // APPROVED | PENDING | REJECTED
  category: string;
  components: WhatsAppTemplateComponent[];
}

export interface WhatsAppTemplateComponent {
  type: string;            // HEADER | BODY | FOOTER | BUTTONS
  text?: string;
  format?: string;
}

export interface WhatsAppSettings {
  enabled: boolean;
  wabaId: string;           // WhatsApp Business Account ID
  phoneNumberId: string;    // Meta Business Phone Number ID
  accessToken: string;      // Permanent access token
  templateName: string;     // Approved template name (lowercase_underscore)
  languageCode: string;     // e.g. "en_US"
  recipientField: string;   // custom field id (phone type) or "fixed:{e164_number}"
  variables: WhatsAppVariableMapping[]; // up to 10 variables
  variableMapping?: Record<string, string>; // Custom variable mappings for templates
  isFlowTemplate?: boolean; // true = Flow template (adds required button/sub_type:flow component)
  flowToken?: string;       // optional flow token (defaults to "unused")
  secondMessage?: SecondMessageConfig; // optional second template sent simultaneously
  ccNumber?: string;        // Business CC number — receives a copy of every booking notification
  templates?: {             // Template configurations for different purposes
    depositInvoice?: string; // Template name for deposit invoices
  };
}

/** Config for a second simultaneous template — shares phoneNumberId/accessToken with parent */
export interface SecondMessageConfig {
  enabled: boolean;
  templateName: string;
  languageCode: string;
  recipientField: string;
  variables: WhatsAppVariableMapping[];
  isFlowTemplate?: boolean;
  flowToken?: string;
}

export const DEFAULT_SECOND_MESSAGE: SecondMessageConfig = {
  enabled: false,
  templateName: "",
  languageCode: "en_US",
  recipientField: "",
  variables: [],
  isFlowTemplate: false,
  flowToken: "unused",
};

export const DEFAULT_WHATSAPP_SETTINGS: WhatsAppSettings = {
  enabled: false,
  wabaId: "",
  phoneNumberId: "",
  accessToken: "",
  templateName: "",
  languageCode: "en_US",
  recipientField: "",
  isFlowTemplate: false,
  flowToken: "unused",
  variables: [{ variableIndex: 1, fieldKey: "title" }],
  ccNumber: "",
};

export interface WhatsAppLog {
  id?: string;
  timestamp: string;
  to: string;
  toOriginal: string;
  templateName: string;
  status: "sent" | "failed" | "skipped";
  messageId?: string | null;
  error?: string;
  taskId: string;
  taskTitle: string;
  parameters: { type: string; text: string }[];
}
