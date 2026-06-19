import { useState, useEffect, useMemo } from "react";
import {
  Users, Plus, Search, Edit, Trash2, DollarSign, Eye, X, Mail, Phone, MapPin, Calendar
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import {
  getCustomers as getAllCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from "@/lib/customerService";
import { getCustomerInvoices } from "@/lib/invoiceService";
import { Customer, CustomerAddress, Invoice } from "@/types/invoice";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface CustomerPageProps {
  onClose: () => void;
}

export function CustomerPage({ onClose }: CustomerPageProps) {
  const { user, workspaceId } = useAuth();
  const { toast } = useToast();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // Create/Edit dialog
  const [showCreate, setShowCreate] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [viewCustomer, setViewCustomer] = useState<Customer | null>(null);
  const [customerInvoices, setCustomerInvoices] = useState<Invoice[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<Customer | null>(null);

  // Form state
  const [formData, setFormData] = useState<{
    companyName: string;
    contactPerson: string;
    email: string;
    phone: string;
    taxNumber: string;
    vatEnabled: boolean;
    paymentTerms: 'net-15' | 'net-30' | 'net-45' | 'due-on-receipt' | 'custom';
    notes: string;
    billingAddress: CustomerAddress;
    shippingAddress: CustomerAddress;
  }>({
    companyName: "",
    contactPerson: "",
    email: "",
    phone: "",
    taxNumber: "",
    vatEnabled: true,
    paymentTerms: 'net-30',
    notes: "",
    billingAddress: {
      street: "",
      city: "",
      state: "",
      postalCode: "",
      country: "South Africa"
    },
    shippingAddress: {
      street: "",
      city: "",
      state: "",
      postalCode: "",
      country: "South Africa"
    },
  });
  const [sameAsBilling, setSameAsBilling] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    loadCustomers();
  }, [workspaceId]);

  async function loadCustomers() {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const data = await getAllCustomers(workspaceId);
      setCustomers(data);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to load customers",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveCustomer() {
    if (!workspaceId || !user) return;

    if (!formData.contactPerson.trim() && !formData.companyName.trim()) {
      toast({
        title: "Validation Error",
        description: "Customer name or company is required",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const customerData = {
        ...formData,
        shippingAddress: sameAsBilling ? formData.billingAddress : formData.shippingAddress,
        currency: "ZAR",
        tags: [],
        status: "active" as const,
      };

      if (editingCustomer) {
        await updateCustomer(workspaceId, editingCustomer.id, customerData, user.uid);
        const nowIso = new Date().toISOString();
        setCustomers((prev) => prev.map((c) =>
          c.id === editingCustomer.id
            ? ({ ...c, ...customerData, updatedAt: nowIso } as Customer)
            : c
        ));
        toast({
          title: "Success",
          description: "Customer updated successfully",
        });
      } else {
        const newCustomer = await createCustomer(workspaceId, customerData, user.uid);
        setCustomers((prev) => [newCustomer, ...prev]);
        toast({
          title: "Success",
          description: "Customer created successfully",
        });
      }

      resetForm();
      setShowCreate(false);
      setEditingCustomer(null);
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to ${editingCustomer ? 'update' : 'create'} customer`,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCustomer() {
    if (!workspaceId || !showDeleteConfirm) return;

    try {
      await deleteCustomer(workspaceId, showDeleteConfirm.id, user?.uid);
      toast({
        title: "Success",
        description: "Customer deleted successfully",
      });
      await loadCustomers();
      setShowDeleteConfirm(null);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete customer",
        variant: "destructive",
      });
    }
  }

  async function handleViewCustomer(customer: Customer) {
    setViewCustomer(customer);
    if (workspaceId) {
      try {
        const invoices = await getCustomerInvoices(workspaceId, customer.id);
        setCustomerInvoices(invoices);
      } catch (error) {
        console.error("Failed to load customer invoices:", error);
      }
    }
  }

  function handleEditCustomer(customer: Customer) {
    setEditingCustomer(customer);
    setFormData({
      companyName: customer.companyName || "",
      contactPerson: customer.contactPerson,
      email: customer.email,
      phone: customer.phone,
      taxNumber: customer.taxNumber || "",
      vatEnabled: customer.vatEnabled !== false,
      paymentTerms: customer.paymentTerms,
      notes: customer.notes || "",
      billingAddress: customer.billingAddress || {
        street: "",
        city: "",
        state: "",
        postalCode: "",
        country: "South Africa"
      },
      shippingAddress: customer.shippingAddress || {
        street: "",
        city: "",
        state: "",
        postalCode: "",
        country: "South Africa"
      },
    });
    setSameAsBilling(
      JSON.stringify(customer.billingAddress) === JSON.stringify(customer.shippingAddress)
    );
    setShowCreate(true);
  }

  function resetForm() {
    setFormData({
      companyName: "",
      contactPerson: "",
      email: "",
      phone: "",
      taxNumber: "",
      vatEnabled: true,
      paymentTerms: 'net-30',
      notes: "",
      billingAddress: {
        street: "",
        city: "",
        state: "",
        postalCode: "",
        country: "South Africa"
      },
      shippingAddress: {
        street: "",
        city: "",
        state: "",
        postalCode: "",
        country: "South Africa"
      },
    });
    setSameAsBilling(true);
  }

  const filteredCustomers = useMemo(() => {
    if (!searchTerm) return customers;
    const term = searchTerm.toLowerCase();
    return customers.filter(
      (c) =>
        (c.companyName ?? c.contactPerson ?? "").toLowerCase().includes(term) ||
        (c.email ?? "").toLowerCase().includes(term) ||
        (c.phone ?? "").includes(term) ||
        (c.customerNumber ?? "").toLowerCase().includes(term)
    );
  }, [customers, searchTerm]);

  const stats = useMemo(() => {
    const total = customers.length;
    const totalRevenue = customers.reduce((sum, c) => sum + (c.totalInvoiced ?? 0), 0);
    const totalOutstanding = customers.reduce((sum, c) => sum + (c.outstandingBalance ?? 0), 0);
    return { total, totalRevenue, totalOutstanding };
  }, [customers]);

  if (loading) {
    return (
      <div className="absolute inset-0 bg-background z-30 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading customers...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-background z-30 flex flex-col">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Users className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Customer Management</h1>
              <p className="text-sm text-muted-foreground">Manage your customer database</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-3 gap-4 p-4 border-t">
          <div className="bg-background rounded-lg p-3 border">
            <div className="text-xs text-muted-foreground mb-1">Total Customers</div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </div>
          <div className="bg-background rounded-lg p-3 border">
            <div className="text-xs text-muted-foreground mb-1">Total Revenue</div>
            <div className="text-2xl font-bold text-green-600">
              R{(stats.totalRevenue ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="bg-background rounded-lg p-3 border">
            <div className="text-xs text-muted-foreground mb-1">Outstanding</div>
            <div className="text-2xl font-bold text-amber-600">
              R{(stats.totalOutstanding ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-3 p-4 border-t">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search customers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button onClick={() => { resetForm(); setShowCreate(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            New Customer
          </Button>
        </div>
      </div>

      {/* Customer List */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-3">
          {filteredCustomers.map((customer) => (
            <div
              key={customer.id}
              className="bg-card border rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-lg">
                      {customer.companyName || customer.contactPerson}
                    </h3>
                    <Badge variant="outline" className="text-xs">
                      {customer.customerNumber}
                    </Badge>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground mb-3">
                    {customer.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="h-3 w-3" />
                        {customer.email}
                      </div>
                    )}
                    {customer.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-3 w-3" />
                        {customer.phone}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Revenue:</span>{" "}
                      <span className="font-semibold text-green-600">
                        R{(customer.totalInvoiced ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Balance:</span>{" "}
                      <span className={cn(
                        "font-semibold",
                        customer.outstandingBalance > 0 ? "text-amber-600" : "text-muted-foreground"
                      )}>
                        R{(customer.outstandingBalance ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleViewCustomer(customer)}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleEditCustomer(customer)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowDeleteConfirm(customer)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ))}

          {filteredCustomers.length === 0 && (
            <div className="text-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                {searchTerm ? "No customers found" : "No customers yet. Create your first customer!"}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCustomer ? "Edit Customer" : "Create New Customer"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Basic Information */}
            <div className="space-y-3">
              <h3 className="font-semibold">Basic Information</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Company Name</Label>
                  <Input
                    value={formData.companyName}
                    onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                    placeholder="Company name (optional)"
                  />
                </div>
                <div className="col-span-2">
                  <Label>Contact Person *</Label>
                  <Input
                    value={formData.contactPerson}
                    onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                    placeholder="Enter contact person name"
                  />
                </div>
                <div>
                  <Label>Email *</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="customer@example.com"
                  />
                </div>
                <div>
                  <Label>Phone *</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+27 XX XXX XXXX"
                  />
                </div>
                <div className="col-span-2">
                  <Label>Tax Number (VAT)</Label>
                  <Input
                    value={formData.taxNumber}
                    onChange={(e) => setFormData({ ...formData, taxNumber: e.target.value })}
                    placeholder="Optional"
                  />
                </div>
                <div className="col-span-2 flex items-center gap-3 pt-1">
                  <Checkbox
                    id="customerVatEnabled"
                    checked={formData.vatEnabled}
                    onCheckedChange={v => setFormData({ ...formData, vatEnabled: v === true })}
                  />
                  <Label htmlFor="customerVatEnabled" className="cursor-pointer font-normal">
                    This customer is VAT registered — charge VAT on invoices
                  </Label>
                </div>
              </div>
            </div>

            {/* Billing Address */}
            <div className="space-y-3">
              <h3 className="font-semibold">Billing Address</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Street Address</Label>
                  <Input
                    value={formData.billingAddress.street}
                    onChange={(e) => setFormData({
                      ...formData,
                      billingAddress: { ...formData.billingAddress, street: e.target.value }
                    })}
                    placeholder="Enter street address"
                  />
                </div>
                <div>
                  <Label>City</Label>
                  <Input
                    value={formData.billingAddress.city}
                    onChange={(e) => setFormData({
                      ...formData,
                      billingAddress: { ...formData.billingAddress, city: e.target.value }
                    })}
                    placeholder="City"
                  />
                </div>
                <div>
                  <Label>State/Province</Label>
                  <Input
                    value={formData.billingAddress.state}
                    onChange={(e) => setFormData({
                      ...formData,
                      billingAddress: { ...formData.billingAddress, state: e.target.value }
                    })}
                    placeholder="State/Province"
                  />
                </div>
                <div>
                  <Label>Postal Code</Label>
                  <Input
                    value={formData.billingAddress.postalCode}
                    onChange={(e) => setFormData({
                      ...formData,
                      billingAddress: { ...formData.billingAddress, postalCode: e.target.value }
                    })}
                    placeholder="Postal code"
                  />
                </div>
                <div>
                  <Label>Country</Label>
                  <Input
                    value={formData.billingAddress.country}
                    onChange={(e) => setFormData({
                      ...formData,
                      billingAddress: { ...formData.billingAddress, country: e.target.value }
                    })}
                    placeholder="Country"
                  />
                </div>
              </div>
            </div>

            {/* Shipping Address */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Shipping Address</h3>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={sameAsBilling}
                    onChange={(e) => setSameAsBilling(e.target.checked)}
                    className="rounded"
                  />
                  Same as billing
                </label>
              </div>
              {!sameAsBilling && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label>Street Address</Label>
                    <Input
                      value={formData.shippingAddress.street}
                      onChange={(e) => setFormData({
                        ...formData,
                        shippingAddress: { ...formData.shippingAddress, street: e.target.value }
                      })}
                      placeholder="Enter street address"
                    />
                  </div>
                  <div>
                    <Label>City</Label>
                    <Input
                      value={formData.shippingAddress.city}
                      onChange={(e) => setFormData({
                        ...formData,
                        shippingAddress: { ...formData.shippingAddress, city: e.target.value }
                      })}
                      placeholder="City"
                    />
                  </div>
                  <div>
                    <Label>State/Province</Label>
                    <Input
                      value={formData.shippingAddress.state}
                      onChange={(e) => setFormData({
                        ...formData,
                        shippingAddress: { ...formData.shippingAddress, state: e.target.value }
                      })}
                      placeholder="State/Province"
                    />
                  </div>
                  <div>
                    <Label>Postal Code</Label>
                    <Input
                      value={formData.shippingAddress.postalCode}
                      onChange={(e) => setFormData({
                        ...formData,
                        shippingAddress: { ...formData.shippingAddress, postalCode: e.target.value }
                      })}
                      placeholder="Postal code"
                    />
                  </div>
                  <div>
                    <Label>Country</Label>
                    <Input
                      value={formData.shippingAddress.country}
                      onChange={(e) => setFormData({
                        ...formData,
                        shippingAddress: { ...formData.shippingAddress, country: e.target.value }
                      })}
                      placeholder="Country"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <Label>Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Additional notes about this customer..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setEditingCustomer(null); }}>
              Cancel
            </Button>
            <Button onClick={handleSaveCustomer} disabled={saving}>
              {saving ? "Saving..." : editingCustomer ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Customer Dialog */}
      <Dialog open={!!viewCustomer} onOpenChange={() => setViewCustomer(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewCustomer?.companyName || viewCustomer?.contactPerson}</DialogTitle>
            <DialogDescription>Customer Details & Invoice History</DialogDescription>
          </DialogHeader>

          {viewCustomer && (
            <div className="space-y-6">
              {/* Customer Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Customer Number</div>
                  <div className="font-mono">{viewCustomer.customerNumber}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Created</div>
                  <div>{new Date(viewCustomer.createdAt).toLocaleDateString()}</div>
                </div>
                {viewCustomer.email && (
                  <div className="col-span-2">
                    <div className="text-sm text-muted-foreground mb-1">Email</div>
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      {viewCustomer.email}
                    </div>
                  </div>
                )}
                {viewCustomer.phone && (
                  <div className="col-span-2">
                    <div className="text-sm text-muted-foreground mb-1">Phone</div>
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4" />
                      {viewCustomer.phone}
                    </div>
                  </div>
                )}
              </div>

              {/* Financial Summary */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-muted rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">Total Invoiced</div>
                  <div className="text-xl font-bold text-green-600">
                    R{(viewCustomer.totalInvoiced ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">Total Paid</div>
                  <div className="text-xl font-bold">
                    R{(viewCustomer.totalPaid ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-1">Balance Due</div>
                  <div className="text-xl font-bold text-amber-600">
                    R{(viewCustomer.outstandingBalance ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {/* Invoices */}
              <div>
                <h3 className="font-semibold mb-3">Invoice History</h3>
                {customerInvoices.length > 0 ? (
                  <div className="space-y-2">
                    {customerInvoices.map((invoice) => (
                      <div key={invoice.id} className="border rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-mono text-sm">{invoice.invoiceNumber}</div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(invoice.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold">
                              R{(invoice.total ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                            </div>
                            <Badge
                              variant={invoice.status === "paid" ? "default" : "secondary"}
                              className="text-xs"
                            >
                              {invoice.status}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No invoices yet
                  </p>
                )}
              </div>

              {/* Addresses */}
              {viewCustomer.billingAddress && (
                <div>
                  <h3 className="font-semibold mb-2">Billing Address</h3>
                  <div className="text-sm text-muted-foreground">
                    {viewCustomer.billingAddress.street && <div>{viewCustomer.billingAddress.street}</div>}
                    {(viewCustomer.billingAddress.city || viewCustomer.billingAddress.state || viewCustomer.billingAddress.postalCode) && (
                      <div>
                        {[viewCustomer.billingAddress.city, viewCustomer.billingAddress.state, viewCustomer.billingAddress.postalCode]
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    )}
                    {viewCustomer.billingAddress.country && <div>{viewCustomer.billingAddress.country}</div>}
                  </div>
                </div>
              )}

              {viewCustomer.notes && (
                <div>
                  <h3 className="font-semibold mb-2">Notes</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {viewCustomer.notes}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!showDeleteConfirm} onOpenChange={() => setShowDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Customer</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{showDeleteConfirm?.companyName || showDeleteConfirm?.contactPerson}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteCustomer}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
