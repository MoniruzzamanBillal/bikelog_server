// Spec 67 — the Service Log module's request-payload and response shapes.

export type TServiceKind = "warranty" | "regular";
export type TServiceStatus = "upcoming" | "completed";
export type TServiceCenterType = "official" | "local";

// A paid additive/accessory inside a service. `id` is server-generated (bson hex); the
// client may omit it on create and the service fills it in. `cost` defaults to 0 (a listed
// item with no cost is still worth recording, e.g. "topped up coolant").
export type TServiceItem = {
  id?: string;
  name: string;
  cost?: number;
};

// A technician recommendation for the future. Pending ones (`done !== true`) with a
// `targetDate` surface as reminders. `id` is server-generated so a single recommendation
// can be toggled by re-submitting the array.
export type TServiceRecommendation = {
  id?: string;
  text: string;
  targetDate?: Date | string | null;
  targetOdometer?: number | null;
  done?: boolean;
};

// The create/update payload. `status` is NOT here — it is derived server-side from
// `serviceDate` presence and never trusted from the client. `warrantyNumber` may be sent,
// but when omitted on a warranty service the service auto-assigns it.
export type TServiceLog = {
  serviceKind?: TServiceKind;
  warrantyNumber?: number | null;
  dueDate?: Date | null;
  serviceDate?: Date | null;
  odometerReading?: number | null;
  serviceCenter?: string | null;
  centerType?: TServiceCenterType | null;
  items?: TServiceItem[];
  recommendations?: TServiceRecommendation[];
  notes?: string | null;
};

// GET /status — warranty progress summary. Every `null`-able field is omitted (not null)
// when absent, so a client tests presence rather than guessing a null's meaning.
export type TServiceStatusSummary = {
  warrantyTotal: 5;
  // completed warranty services (the ones that actually keep the warranty valid)
  warrantyCompleted: number;
  // every warranty service logged, upcoming or completed
  warrantyLogged: number;
  // earliest upcoming warranty service with a due date
  nextWarranty?: {
    number: number | null;
    dueDate: Date;
    status: "overdue" | "upcoming";
  };
  // earliest upcoming service of ANY kind with a due date
  nextService?: {
    dueDate: Date;
    status: "overdue" | "upcoming";
  };
  // true when an upcoming warranty service is already past its due date — the warranty is
  // at risk of being voided
  warrantyVoidRisk: boolean;
};
