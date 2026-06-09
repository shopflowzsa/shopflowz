// Internal knowledge bot — no external API calls, answers from embedded app knowledge.

export interface BotResponse {
  answer: string;
  navigate?: string;      // event key dispatched to Index.tsx
  navigateLabel?: string; // label on the button, e.g. "Open Inventory"
}

interface KnowledgeEntry {
  keywords: string[];
  answer: string;
  navigate?: string;
  navigateLabel?: string;
}

const KB: KnowledgeEntry[] = [
  {
    keywords: ["hello", "hi", "hey", "help", "start", "what can you do", "who are you"],
    answer: `Hi! I'm the ShopFlowz assistant. I know everything about this app and can help you with:

• **CRM & Tasks** — managing jobs, spaces, lists and statuses
• **Walk-in Sales** — counter POS for quick sales
• **Invoicing** — quotes, invoices, payments and reports
• **Inventory** — products, stock levels and movements
• **Ecommerce** — your public store and online orders
• **Banking & Matching** — reconcile bank transactions
• **Forms** — intake forms that auto-create tasks
• **WhatsApp** — message logs and communication
• **Team** — invite members and manage roles
• **Import / Export** — back up or restore your workspace

Just ask me anything!`,
  },
  {
    keywords: ["task", "job", "add task", "create task", "new task", "crm", "space", "folder", "list", "status", "to do", "in progress", "review", "done", "board", "kanban", "where task", "where do i add", "where add task"],
    answer: `**Adding a Task**

Tasks live inside a **Space → Folder → List** in the CRM.

**To add a task:**
1. Click a List in the left sidebar to open it.
2. Click the **+ Add Task** link inside any column (To Do, In Progress, etc.), or use the **+ Task** button in the top-right corner.
3. Fill in the title, description, due date, assignee and priority.

**Tip:** Use **Forms** to let customers or staff submit tasks without needing access to the dashboard.

Would you like me to take you to the CRM task board?`,
    navigate: "tasks",
    navigateLabel: "Go to CRM",
  },
  {
    keywords: ["product", "add product", "new product", "create product", "where product", "where do i add product", "inventory", "stock", "item", "sku", "barcode", "stock level", "stock movement", "reorder"],
    answer: `**Adding a Product**

Products are managed in the **Inventory** section.

**To add a product:**
1. Open **Inventory** from the sidebar.
2. Click **+ Add Product**.
3. Fill in the name, SKU, barcode, selling price, cost price and stock quantity.
4. Upload product images (they appear in your public store automatically).
5. Set a minimum stock level so the app warns you when stock runs low.

Once added, products are available in Walk-in Sales, Invoicing and your Ecommerce store.`,
    navigate: "inventory",
    navigateLabel: "Open Inventory",
  },
  {
    keywords: ["invoice", "add invoice", "create invoice", "new invoice", "quote", "quotation", "create quote", "billing", "payment", "receipt", "statement", "report", "financial", "where invoice", "sales"],
    answer: `**Creating an Invoice or Quote**

Invoicing is under **Sales & Invoicing** in the sidebar.

**To create an invoice:**
1. Open **Sales & Invoicing**.
2. Click **+ New Invoice** (or **+ New Quote** for a quote first).
3. Select the customer, add line items from your inventory, apply tax/discount.
4. Save and send — download PDF or email directly from the app.

**Flow:** Quote → Invoice → Record Payment → Statement`,
    navigate: "invoicing",
    navigateLabel: "Open Sales & Invoicing",
  },
  {
    keywords: ["form", "intake", "intake form", "task form", "booking", "request", "customer form", "staff form", "submit task", "where form", "add form", "create form", "new form", "forms builder"],
    answer: `**Setting Up a Form**

Forms are in the **Forms** section of the sidebar (under CRM).

**To create a form:**
1. Open **Forms Builder**.
2. Click **New Form** and give it a name (e.g. "Repair Intake").
3. Add fields — text, dropdown, photo, signature, date, etc.
4. Choose which CRM list new submissions should create tasks in.
5. Copy the public link and share it (WhatsApp, SMS, email or QR code).

Every submission creates a task automatically — no dashboard access needed for the person filling it in.`,
    navigate: "forms",
    navigateLabel: "Open Forms Builder",
  },
  {
    keywords: ["whatsapp", "whats app", "message", "sms", "communication", "chat log", "where whatsapp", "open whatsapp"],
    answer: `**WhatsApp**

The WhatsApp section keeps a log of all messages sent and received via WhatsApp Business API.

**Features:**
- View full conversation history per customer.
- Link messages to a task or invoice.
- Send templated messages (reminders, invoice links, completion notices).
- Staff can reply from within the app.

**To connect:** Go to **Settings → WhatsApp** and enter your WhatsApp Business API credentials.`,
    navigate: "whatsapp",
    navigateLabel: "Open WhatsApp",
  },
  {
    keywords: ["banking", "bank", "transaction", "reconcile", "match", "import bank", "bank statement", "where banking"],
    answer: `**Banking & Matching**

Import your bank statement and match transactions to invoices automatically.

**Steps:**
1. Open **Banking & Matching**.
2. Import a bank CSV (most South African banks supported).
3. The app auto-suggests matches by amount and reference.
4. Confirm or manually link each transaction.

Unmatched transactions are flagged for review.`,
    navigate: "banking",
    navigateLabel: "Open Banking & Matching",
  },
  {
    keywords: ["team", "member", "user", "invite", "staff", "admin", "owner", "role", "permission", "access", "where invite", "add user", "add member"],
    answer: `**Inviting Team Members**

Manage your team under **Settings → Manage Users**.

**Three roles:**
- **Owner** — full access including billing and settings.
- **Admin** — everything except billing and owner-only settings.
- **Staff** — tasks, inventory, walk-in sales, forms.

**To invite:**
1. Click **Invite Member** and enter their email.
2. Choose their role.
3. They receive a sign-up link by email.`,
    navigate: "users",
    navigateLabel: "Open Manage Users",
  },
  {
    keywords: ["store", "ecommerce", "online store", "shop", "public", "customer", "order", "product listing", "cart", "checkout", "where store", "open store", "ecommerce settings"],
    answer: `**Ecommerce / Public Store**

Your store is at **shopflowz.web.app/store/your-slug** (or your custom domain).

**To set up:**
1. Open **Ecommerce Settings**.
2. Set your store slug and enable the store.
3. Products from Inventory appear automatically.
4. Customers can browse, add to cart and pay via iKhokha.

Orders appear in the **Ecommerce** section of the sidebar.`,
    navigate: "ecommerce",
    navigateLabel: "Open Ecommerce",
  },
  {
    keywords: ["customer", "client", "contact", "account", "where customer", "add customer", "new customer"],
    answer: `**Customers**

Customers are managed in **Sales & Invoicing → Customers**.

**To add a customer:**
1. Open **Sales & Invoicing**.
2. Go to the **Customers** tab.
3. Click **+ New Customer** and fill in their details.

Customer records store contact info, invoice history and outstanding balances. You can email statements directly from the customer record.`,
    navigate: "customers",
    navigateLabel: "Open Customers",
  },
  {
    keywords: ["walk-in", "walkin", "walk in", "counter", "pos", "point of sale", "quick sale", "cash sale"],
    answer: `**Walk-in Sale (Counter)**

The Walk-in Sale is a quick POS screen for in-person customers.

**How it works:**
1. Click **Walk-in Sale** in the sidebar (labelled "counter").
2. Search or scan products to add to the basket.
3. Apply a discount if needed.
4. Choose payment method (cash, card, EFT).
5. Complete the sale — receipt is printed or emailed.

Walk-in sales update stock levels and are recorded as invoices automatically.`,
  },
  {
    keywords: ["photo", "image", "picture", "missing photo", "jobs with issues", "upload photo"],
    answer: `**Photos & Tasks with Issues**

The **⚠ Tasks with Issues** item in the sidebar lists tasks missing required photos.

**To fix:**
1. Open the task from Tasks with Issues.
2. Tap the camera icon inside the task to upload a photo.
3. Once a photo is attached the task moves back to its original list automatically.

Use **Take Photo of Slip** in the sidebar to snap and attach expense receipts.`,
  },
  {
    keywords: ["import", "export", "backup", "restore", "zip", "data", "migrate"],
    answer: `**Import & Export**

Back up or restore your workspace from **Settings → Export / Import**.

**Export:** Packages all data (tasks, customers, invoices, inventory, photos) into a ZIP file. Click **Export All Data** to download.

**Import:** Select a ZIP file previously exported from ShopFlowz or srclickup. Records are upserted — existing IDs update, new ones are created.

Photo files are included in the ZIP for reference; original Cloudinary URLs remain valid after import.`,
  },
  {
    keywords: ["dark mode", "light mode", "mixed mode", "theme", "colour", "color", "sidebar colour", "appearance"],
    answer: `**Themes**

Click the **mode** button at the top of the sidebar (next to your email) to cycle through three themes:

- ☀️ **Light** — white sidebar, white main area.
- 🌗 **Mixed** — dark sidebar, light main area.
- 🌙 **Dark** — full dark mode.

Your choice is saved and remembered next session.`,
  },
  {
    keywords: ["setup", "wizard", "onboarding", "getting started", "first time", "new workspace", "configure"],
    answer: `**Setup Wizard**

The Setup Wizard guides you through configuring your workspace step by step — business info, logo, store URL, products, payments, invoicing, team, forms and WhatsApp.

Return to it any time via **Settings → Setup Wizard**.`,
  },
  {
    keywords: ["payment", "ikhokha", "card", "eft", "cash", "pay", "payment gateway", "online payment"],
    answer: `**Payments & iKhokha**

ShopFlowz integrates with **iKhokha** for card and online payments.

- **Walk-in:** Accept card via iKhokha card reader — recorded automatically.
- **Online store:** Customers pay via iKhokha's secure checkout.
- **Manual:** Record cash or EFT against any invoice via **Record Payment**.

Configure credentials under **Settings → Billing & Payments**.`,
  },
  {
    keywords: ["report", "analytics", "dashboard", "summary", "revenue", "trend", "chart", "graph"],
    answer: `**Reports & Analytics**

Available under **Sales & Invoicing → Reports**:

- Revenue summary (daily, weekly, monthly)
- Outstanding invoices
- Payment trends
- Inventory value
- Customer statements

All reports export to PDF or CSV.`,
    navigate: "invoicing",
    navigateLabel: "Open Sales & Invoicing",
  },
  {
    keywords: ["email", "send email", "mail", "smtp", "notification"],
    answer: `**Email**

Send and track emails to customers directly from ShopFlowz — invoices and quotes attach as PDF automatically.

Configure SMTP or Gmail under **Settings → Email Settings**.`,
    navigate: "email",
    navigateLabel: "Open Email",
  },
  {
    keywords: ["logo", "brand", "branding", "upload logo", "business name", "business info"],
    answer: `**Business Branding**

Your logo and business details appear on all invoices, quotes, emails and your public store.

Update under **Settings → Business Info** (or via the Setup Wizard):
- Upload logo (PNG/JPG, ideally square)
- Business name, address, VAT number, contact details`,
  },
  {
    keywords: ["mobile", "mobile app", "app", "phone", "android", "iphone", "pwa", "install"],
    answer: `**Mobile App**

ShopFlowz works on mobile via your browser — no app store needed.

**To install:**
1. Open shopflowz.web.app on Chrome (Android) or Safari (iPhone).
2. Tap Share → **Add to Home Screen**.

The **Mobile App** button in the top bar shows a QR code your team can scan to install instantly.`,
  },
  {
    keywords: ["slug", "url", "domain", "custom domain", "store url", "store link"],
    answer: `**Store URL & Custom Domain**

Your store: **shopflowz.web.app/store/your-slug**

**Change slug:** Ecommerce → Settings → Store URL tab.

**Custom domain (e.g. shop.yourbusiness.co.za):** Ecommerce → Settings → Custom Domain tab. Enter your domain, get DNS records, add them at your registrar (propagates in up to 24 hours).`,
    navigate: "ecommerce-settings",
    navigateLabel: "Open Store Settings",
  },
  {
    keywords: ["settings", "setting", "configure", "configuration", "gear", "preferences"],
    answer: `**Settings**

Click the **gear icon (⚙)** at the bottom of the sidebar.

Available settings:
- Business Info (name, logo, address, VAT)
- Store URL / Custom Domain
- Email Settings (SMTP/Gmail)
- WhatsApp API credentials
- Billing & Payments (iKhokha)
- Manage Users (team roles)
- Import / Export (backup/restore)
- Setup Wizard (guided onboarding)`,
  },
  {
    keywords: ["expense", "slip", "expense slip", "cost", "take photo", "scan slip"],
    answer: `**Expense Slips**

Click **Take Photo of Slip** in the sidebar to capture a paper receipt.

1. Camera opens — snap the receipt.
2. Add amount, description and category.
3. Saved to your workspace for review in Banking & Matching or export.`,
  },
];

// ─── Scoring ───────────────────────────────────────────────────────────────────

function scoreEntry(entry: KnowledgeEntry, question: string): number {
  const q = question.toLowerCase();
  const words = q.split(/\s+/);
  let s = 0;
  for (const kw of entry.keywords) {
    if (q.includes(kw)) s += kw.split(" ").length * 2;
    else for (const w of words) if (kw.includes(w) && w.length > 3) s += 1;
  }
  return s;
}

// ─── Main function ────────────────────────────────────────────────────────────

export function askInternalBot(question: string): BotResponse {
  if (!question.trim()) {
    return { answer: "Please type a question and I'll do my best to help!" };
  }

  const scored = KB.map((entry) => ({ entry, s: scoreEntry(entry, question) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);

  if (scored.length === 0) {
    return {
      answer: `I don't have a specific answer for that yet, but I can help with:\n\n• Tasks & CRM\n• Walk-in Sales\n• Invoicing & Quotes\n• Inventory & Products\n• Ecommerce Store\n• Banking & Matching\n• Forms\n• WhatsApp\n• Team Members\n• Import / Export\n• Themes & Settings\n\nTry asking about one of those topics!`,
    };
  }

  const best = scored[0].entry;
  return {
    answer: best.answer,
    navigate: best.navigate,
    navigateLabel: best.navigateLabel,
  };
}
