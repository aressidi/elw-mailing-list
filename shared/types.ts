// Shared types for ELW Mailing List App

export interface MailingListRecord {
  id: number;
  firstName: string | null;
  lastName: string | null;
  spouseFirstName: string | null;
  spouseLastName: string | null;
  companyName: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  propertyCounty: string | null;
  acres: number | null;
  apn: string | null;
  offerPrice: number | null;
  offerPerAcre: number | null;
  mailingSalutation: string | null;
  mailingAddress: string | null;
  mailingCity: string | null;
  mailingState: string | null;
  mailingZip: string | null;
  doNotMail: boolean;
  badAddress: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRecordInput {
  firstName?: string;
  lastName?: string;
  spouseFirstName?: string;
  spouseLastName?: string;
  companyName?: string;
  propertyAddress?: string;
  propertyCity?: string;
  propertyState?: string;
  propertyZip?: string;
  propertyCounty?: string;
  acres?: number;
  apn?: string;
  offerPrice?: number;
  offerPerAcre?: number;
  mailingSalutation?: string;
  mailingAddress?: string;
  mailingCity?: string;
  mailingState?: string;
  mailingZip?: string;
  doNotMail?: boolean;
  badAddress?: boolean;
}

export interface UpdateRecordInput extends Partial<CreateRecordInput> {}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}