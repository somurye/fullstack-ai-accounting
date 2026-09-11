import type { components } from '../../types/api.generated';

export type SupplierDto = components['schemas']['Supplier'];
export type SupplierStatus = components['schemas']['SupplierStatus'];
export type SupplierCreateInput = components['schemas']['SupplierCreate'];
export type SupplierUpdateInput = components['schemas']['SupplierUpdate'];

export interface SupplierFormValues {
  name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  payment_terms: string;
  status: 'active' | 'inactive';
}
