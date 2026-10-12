export type UserRole = 'PARENT' | 'ADMIN' | 'STAFF';

export type PaymentMethod = 'UPI' | 'CARD' | 'NET_BANKING';
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';
export type OrderStatus = 'CONFIRMED' | 'PREPARING' | 'READY' | 'COLLECTED' | 'CANCELLED';

export interface UserSession {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  role: UserRole;
  parentId?: string;
}

export type StudentCategory = 'Pre-primary' | 'Primary' | 'Secondary';

export interface StudentData {
  id: string;
  parentId: string;
  name: string;
  dob?: string | null;
  grade: string;
  division: string;
  rollNo: string;
  studentId: string;
  studentCategory?: StudentCategory;
  allergies?: string | null;
  allergiesList?: string[];
  dietaryRestrictions?: string | null;
  foodPreference?: string | null;
  notes?: string | null;
  isVegetarian: boolean;
  profilePhoto?: string | null;
  isActive: boolean;
  allergyAlertStatus?: 'NO_ALLERGY' | 'ALLERGY_RECORDED' | 'CONFLICT_DETECTED';
}

export interface MealData {
  id: string;
  name: string;
  description: string;
  category: string; // BREAKFAST, LUNCH, SNACK, BEVERAGE, BRUNCH
  isVegetarian: boolean;
  ingredients?: string | null;
  allergens?: string | null;
  allergensList?: string[];
  calories?: number | null;
  price: number;
  imageUrl?: string | null;
}

export interface MenuDayItem {
  id: string;
  mealId: string;
  meal: MealData;
  date: string;
  studentCategory?: string;
  isHoliday?: boolean;
  holidayReason?: string;
  availableQuantity: number;
  maxQuantity: number;
  orderingDeadline: string;
  isActive: boolean;
  isAvailable?: boolean;
  isDeadlinePassed?: boolean;
  isPastDate?: boolean;
}

export interface CartItem {
  cartItemId: string; // unique key: `${studentId}-${mealId}-${date}`
  studentId: string;
  studentName: string;
  studentGrade: string;
  studentDivision: string;
  studentCategory?: string;
  mealId: string;
  mealName: string;
  mealPrice: number;
  mealCategory?: string;
  mealImage?: string | null;
  isVegetarian: boolean;
  date: string; // "YYYY-MM-DD"
  quantity: number;
  orderingDeadline?: string;
  hasAllergyAlert?: boolean;
  conflictAllergens?: string[];
}

export interface OrderItemData {
  id: string;
  studentId: string;
  studentName: string;
  studentGrade: string;
  studentDivision: string;
  studentRollNo: string;
  studentCategory?: string;
  mealId: string;
  mealName: string;
  mealCategory: string;
  mealImage?: string | null;
  isVegetarian: boolean;
  date: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  hasAllergyAlert?: boolean;
  conflictAllergens?: string | null;
}

export interface PaymentData {
  id: string;
  orderId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  transactionRef: string;
  upiId?: string | null;
  cardLastFour?: string | null;
  bankName?: string | null;
  createdAt: string;
}

export interface OrderData {
  id: string;
  parentId: string;
  parentName?: string;
  parentEmail?: string;
  parentPhone?: string;
  totalAmount: number;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  notes?: string | null;
  createdAt: string;
  items: OrderItemData[];
  payments: PaymentData[];
}
