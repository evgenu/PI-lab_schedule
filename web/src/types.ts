// Shapes of the API responses, as the browser sees them.
export type Role = 'student' | 'teacher' | 'admin';
export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type SlotState = 'free' | 'pending' | 'approved' | 'past';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export interface Lab {
  id: number;
  name: string;
  building: string;
  capacity: number;
  description: string;
}

export interface Availability {
  date: string;
  hours: number[];
  labs: { lab: Lab; slots: { hour: number; state: SlotState }[] }[];
}

export interface Booking {
  id: number;
  labId: number;
  labName: string;
  userId: number;
  date: string;
  hour: number;
  purpose: string;
  status: BookingStatus;
}

export interface Suggestion {
  labId: number;
  labName: string;
  date: string;
  hour: number;
  reason: string;
}

export interface SuggestionResult {
  source: 'model' | 'fallback';
  suggestion: Suggestion | null;
}
