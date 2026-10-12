/**
 * Official October 2026 School Brunch Timetable & Student Category System
 * Authoritative source of truth for S.B. Patil School / School-Bite.
 */

export type StudentCategory = 'Pre-primary' | 'Primary' | 'Secondary';

export const STUDENT_CATEGORIES: StudentCategory[] = ['Pre-primary', 'Primary', 'Secondary'];

export interface TimetableDayEntry {
  date: string; // "YYYY-MM-DD"
  displayDate: string; // "01/10/2026"
  day: string; // "Thursday"
  menus: {
    'Pre-primary': {
      dish: string;
      isHoliday: boolean;
      holidayReason?: string;
    };
    Primary: {
      dish: string;
      isHoliday: boolean;
      holidayReason?: string;
    };
    Secondary: {
      dish: string;
      isHoliday: boolean;
      holidayReason?: string;
    };
  };
}

export interface MealCatalogItem {
  id: string;
  name: string;
  description: string;
  category: 'LUNCH' | 'BREAKFAST' | 'BRUNCH';
  price: number;
  isVegetarian: boolean;
  allergens?: string;
  ingredients?: string;
  calories?: number;
}

export const OCTOBER_2026_MEAL_CATALOG: MealCatalogItem[] = [
  {
    id: 'meal_oct_uttappa_chutney_sambar',
    name: 'Uttappa + Chutney + Sambar',
    description: 'Fresh warm South Indian vegetable uttappa served with fresh coconut chutney and vegetable sambar.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Mustard',
    ingredients: 'Rice batter, urad dal, onion, tomato, curry leaves, coconut chutney, sambar vegetables',
    calories: 340,
  },
  {
    id: 'meal_oct_masala_bhata_kadhi_matki',
    name: 'Masala Bhata + Kadhi + Matki Chat + Papad',
    description: 'Traditional spiced masala rice paired with soothing tempered curd kadhi, healthy matki chaat and crispy papad.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Milk',
    ingredients: 'Basmati rice, whole spices, curd, besan, sprouted matki, papad, fresh coriander',
    calories: 420,
  },
  {
    id: 'meal_oct_bhindi_masala_dal_chapati',
    name: 'Bhindi Masala + Dal + Chapati + Rice + Sweet',
    description: 'Spiced tender okra masala served with homestyle yellow dal, fresh whole wheat chapatis, steamed rice and sweet treat.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat, Milk',
    ingredients: 'Fresh okra, onions, tomatoes, toor dal, whole wheat flour, rice, gulab jamun/sweet',
    calories: 460,
  },
  {
    id: 'meal_oct_aloo_matar_dal_chapati',
    name: 'Aloo Matar + Dal + Chapati + Rice + Salad',
    description: 'Comforting potato and green peas curry with tempered toor dal, soft chapatis, steamed rice and crisp seasonal salad.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat',
    ingredients: 'Potatoes, green peas, cumin, toor dal, whole wheat chapatis, steamed rice, cucumber carrot salad',
    calories: 430,
  },
  {
    id: 'meal_oct_veg_biryani_gravy_banana',
    name: 'Veg Biryani + Gravy + Banana + Rosted Papad',
    description: 'Fragrant garden vegetable biryani with savory spiced gravy, whole nutritious banana and roasted papad.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Milk',
    ingredients: 'Long-grain basmati rice, mixed vegetables, aromatic biryani spices, curd gravy, fresh banana, roasted papad',
    calories: 480,
  },
  {
    id: 'meal_oct_plain_rice_baigan_masala',
    name: 'Plain Rice + Baigan Masala + Dal Palak + Chapati',
    description: 'Flavorful spiced brinjal masala accompanied by nutrient-rich spinach dal, fluffy steamed rice and warm chapatis.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat, Peanuts',
    ingredients: 'Steamed rice, brinjal, peanut sesame masala, spinach, toor dal, whole wheat chapatis',
    calories: 410,
  },
  {
    id: 'meal_oct_veg_hyderabadi_chapati_rice',
    name: 'Veg Hyderabadi + Chapati + Rice',
    description: 'Rich royal Hyderabadi mixed vegetable curry served with soft whole wheat chapatis and steamed basmati rice.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat, Milk, Tree Nuts',
    ingredients: 'Assorted vegetables, mint, spinach gravy, whole wheat chapatis, basmati rice',
    calories: 440,
  },
  {
    id: 'meal_oct_tadka_rice_dal_makhani',
    name: 'Tadka Rice + Dal Makhani + Chapati',
    description: 'Slow-cooked creamy black lentil dal makhani paired with cumin tempered rice and soft chapatis.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat, Milk',
    ingredients: 'Black urad lentils, kidney beans, butter, whole wheat chapatis, jeera tadka rice',
    calories: 490,
  },
  {
    id: 'meal_oct_mix_veg_dal_chapati_rice',
    name: 'Mix Veg + Dal + Chapati + Rice',
    description: 'Wholesome medley of seasonal vegetables with seasoned yellow dal, freshly rolled chapatis and steamed rice.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat',
    ingredients: 'Carrots, beans, peas, cauliflower, toor dal, wheat chapatis, steamed rice',
    calories: 420,
  },
  {
    id: 'meal_oct_plain_rice_soyabean_masala',
    name: 'Plain Rice + Soyabean Masala + Chapati + Salad',
    description: 'Protein-packed soya chunks in rich onion-tomato curry served with steamed rice, soft chapatis and cucumber salad.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat, Soy',
    ingredients: 'Steamed rice, soya chunks, onion tomato masala, whole wheat chapatis, garden salad',
    calories: 450,
  },
  {
    id: 'meal_oct_mushroom_matar_dal_chapati',
    name: 'Mushroom Matar + Dal + Chapati + Rice',
    description: 'Fresh sliced button mushrooms and tender green peas in mild curry with wholesome dal, chapatis and rice.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat',
    ingredients: 'Fresh mushrooms, sweet peas, yellow dal, whole wheat chapatis, steamed rice',
    calories: 410,
  },
  {
    id: 'meal_oct_rice_corn_matter_palak',
    name: 'Rice + Corn Matter Palak + Waran + Chapati',
    description: 'Nutritious sweet corn and peas folded in creamy spinach puree, served with traditional waran bhat and chapatis.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat',
    ingredients: 'Steamed rice, sweet corn, green peas, spinach puree, yellow waran, whole wheat chapatis',
    calories: 430,
  },
  {
    id: 'meal_oct_jeera_rice_chole_bhaji',
    name: 'Jeera Rice + Chole Bhaji + Chapati + Salad',
    description: 'Punjabi spiced chickpea curry (chole) served alongside fragrant cumin rice, whole wheat chapatis and crunchy salad.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat',
    ingredients: 'Kabuli chana, amchur, cumin basmati rice, whole wheat chapatis, sliced cucumber & tomato',
    calories: 470,
  },
  {
    id: 'meal_oct_mix_sprout_dal_chapati_rice',
    name: 'Mix Sprout + Dal + Chapati + Rice',
    description: 'Healthy sprouted legumes (moong, matki, chana) tempered with spices, accompanied by lentil dal, chapatis and rice.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat',
    ingredients: 'Mixed sprouted beans, toor dal, cumin, whole wheat chapatis, steamed rice',
    calories: 400,
  },
  {
    id: 'meal_oct_paneer_do_pyaza_dal_lasuni',
    name: 'Paneer Do Pyaza + Dal Lasuni + Rice + Chapati',
    description: 'Fresh cottage cheese cooked with caramelised onions in tomato gravy, paired with garlic-tempered dal, rice and chapatis.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat, Milk',
    ingredients: 'Fresh paneer, double onions, garlic tempered toor dal, whole wheat chapatis, steamed rice',
    calories: 490,
  },
  {
    id: 'meal_oct_gobi_mutter_dry_masoor_dal',
    name: 'Gobi Mutter Dry + Masoor Dal + Chapati + Rice',
    description: 'Tender cauliflower florets and sweet green peas sauteed homestyle, served with protein-rich red masoor dal and chapatis.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat',
    ingredients: 'Cauliflower, green peas, turmeric, whole masoor dal, whole wheat chapatis, steamed rice',
    calories: 420,
  },
  {
    id: 'meal_oct_lauki_chana_dal_chapati',
    name: 'Lauki Chana + Dal + Chapati + Rice + Pickle',
    description: 'Mildly spiced bottle gourd and Bengal gram curry served with comforting dal, warm chapatis, rice and tangy mango pickle.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat, Mustard',
    ingredients: 'Fresh bottle gourd, chana dal, yellow lentil dal, whole wheat chapatis, steamed rice, school pickle',
    calories: 410,
  },
  {
    id: 'meal_oct_idli_sambar_chutney',
    name: 'Idli + Sambar + Chutney',
    description: 'Fluffy steamed rice & lentil idlis accompanied by authentic lentil vegetable sambar and fresh coconut chutney.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Mustard',
    ingredients: 'Steamed idlis (rice, urad dal), mixed vegetable sambar, freshly ground coconut chutney',
    calories: 330,
  },
  {
    id: 'meal_oct_aloo_paratha_pulav_curd',
    name: 'Aloo Paratha + Pulav + Curd + Sweet',
    description: 'Golden spiced potato stuffed whole wheat parathas served with vegetable pulav, chilled plain curd and festive sweet.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat, Milk',
    ingredients: 'Whole wheat flour, spiced potato filling, basmati vegetable pulav, fresh curd, sweet treat',
    calories: 520,
  },
  {
    id: 'meal_oct_rajma_dal_chapati_rice',
    name: 'Rajma + Dal + Chapati + Rice',
    description: 'Classic Kashmiri red kidney bean curry slow cooked in onion-tomato gravy, served with dal, soft chapatis and rice.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat',
    ingredients: 'Red kidney beans, cumin, whole wheat chapatis, yellow dal, steamed basmati rice',
    calories: 460,
  },
  {
    id: 'meal_oct_veg_cutlet_banana',
    name: 'Veg Cutlet (Shallow fry) + Banana',
    description: 'Crispy shallow-fried vegetable patties made with potatoes, peas and carrots, served with a sweet ripe fresh banana.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat',
    ingredients: 'Potatoes, carrots, green peas, breadcrumbs, shallow fry oil, fresh ripe banana',
    calories: 360,
  },
  {
    id: 'meal_oct_green_moong_dal_chapati',
    name: 'Green Moong + Dal + Chapati + Rice',
    description: 'Wholesome whole green gram curry rich in dietary fiber, paired with yellow dal, whole wheat chapatis and steamed rice.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat',
    ingredients: 'Whole green moong, tempered yellow dal, whole wheat chapatis, steamed rice',
    calories: 430,
  },
  {
    id: 'meal_oct_dosa_bhaji_dal_palak',
    name: 'Dosa Bhaji + Dal Palak + Rice + Chapati + Salad',
    description: 'Flavorful spiced potato bhaji paired with nourishing spinach dal, soft chapatis, rice and fresh salad greens.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat, Mustard',
    ingredients: 'Spiced potato bhaji, toor dal, fresh spinach, whole wheat chapatis, steamed rice, garden salad',
    calories: 440,
  },
  {
    id: 'meal_oct_mix_veg_paratha_curd_khichadi',
    name: 'Mix Veg Paratha + Curd + Dalkhichadi',
    description: 'Nutritious grated mixed vegetable parathas accompanied by cooling fresh curd and comforting moong dal khichdi.',
    category: 'LUNCH',
    price: 80,
    isVegetarian: true,
    allergens: 'Wheat, Milk',
    ingredients: 'Whole wheat parathas stuffed with veggies, fresh home curd, yellow moong dal khichdi',
    calories: 480,
  },
  // Relational placeholder for school holidays
  {
    id: 'meal_holiday_no_brunch',
    name: 'Holiday — No Brunch',
    description: 'School canteen closed for brunch due to official holiday / weekend.',
    category: 'BRUNCH',
    price: 0,
    isVegetarian: true,
    allergens: '',
    ingredients: 'None (Holiday)',
    calories: 0,
  },
];

export const OCTOBER_2026_TIMETABLE: TimetableDayEntry[] = [
  {
    date: '2026-10-01',
    displayDate: '01/10/2026',
    day: 'Thursday',
    menus: {
      'Pre-primary': { dish: 'Uttappa + Chutney + Sambar', isHoliday: false },
      Primary: { dish: 'Uttappa + Chutney + Sambar', isHoliday: false },
      Secondary: { dish: 'Uttappa + Chutney + Sambar', isHoliday: false },
    },
  },
  {
    date: '2026-10-02',
    displayDate: '02/10/2026',
    day: 'Friday',
    menus: {
      'Pre-primary': { dish: 'Mahatma Gandhi Jayanti Holiday', isHoliday: true, holidayReason: 'Mahatma Gandhi Jayanti Holiday' },
      Primary: { dish: 'Holiday', isHoliday: true, holidayReason: 'Mahatma Gandhi Jayanti Holiday' },
      Secondary: { dish: 'Holiday', isHoliday: true, holidayReason: 'Mahatma Gandhi Jayanti Holiday' },
    },
  },
  {
    date: '2026-10-03',
    displayDate: '03/10/2026',
    day: 'Saturday',
    menus: {
      'Pre-primary': { dish: 'Holiday', isHoliday: true, holidayReason: 'Saturday Holiday' },
      Primary: { dish: 'Holiday', isHoliday: true, holidayReason: 'Saturday Holiday' },
      Secondary: { dish: 'Holiday', isHoliday: true, holidayReason: 'Saturday Holiday' },
    },
  },
  {
    date: '2026-10-04',
    displayDate: '04/10/2026',
    day: 'Sunday',
    menus: {
      'Pre-primary': { dish: 'Holiday', isHoliday: true, holidayReason: 'Sunday Holiday' },
      Primary: { dish: 'Holiday', isHoliday: true, holidayReason: 'Sunday Holiday' },
      Secondary: { dish: 'Holiday', isHoliday: true, holidayReason: 'Sunday Holiday' },
    },
  },
  {
    date: '2026-10-05',
    displayDate: '05/10/2026',
    day: 'Monday',
    menus: {
      'Pre-primary': { dish: 'Masala Bhata + Kadhi + Matki Chat + Papad', isHoliday: false },
      Primary: { dish: 'Masala Bhata + Kadhi + Matki Chat + Papad', isHoliday: false },
      Secondary: { dish: 'Masala Bhata + Kadhi + Matki Chat + Papad', isHoliday: false },
    },
  },
  {
    date: '2026-10-06',
    displayDate: '06/10/2026',
    day: 'Tuesday',
    menus: {
      'Pre-primary': { dish: 'Bhindi Masala + Dal + Chapati + Rice + Sweet', isHoliday: false },
      Primary: { dish: 'Bhindi Masala + Dal + Chapati + Rice + Sweet', isHoliday: false },
      Secondary: { dish: 'Bhindi Masala + Dal + Chapati + Rice + Sweet', isHoliday: false },
    },
  },
  {
    date: '2026-10-07',
    displayDate: '07/10/2026',
    day: 'Wednesday',
    menus: {
      'Pre-primary': { dish: 'Aloo Matar + Dal + Chapati + Rice + Salad', isHoliday: false },
      Primary: { dish: 'Aloo Matar + Dal + Chapati + Rice + Salad', isHoliday: false },
      Secondary: { dish: 'Aloo Matar + Dal + Chapati + Rice + Salad', isHoliday: false },
    },
  },
  {
    date: '2026-10-08',
    displayDate: '08/10/2026',
    day: 'Thursday',
    menus: {
      'Pre-primary': { dish: 'Veg Biryani + Gravy + Banana + Rosted Papad', isHoliday: false },
      Primary: { dish: 'Veg Biryani + Gravy + Banana + Rosted Papad', isHoliday: false },
      Secondary: { dish: 'Veg Biryani + Gravy + Banana + Rosted Papad', isHoliday: false },
    },
  },
  {
    date: '2026-10-09',
    displayDate: '09/10/2026',
    day: 'Friday',
    menus: {
      'Pre-primary': { dish: 'Plain Rice + Baigan Masala + Dal Palak + Chapati', isHoliday: false },
      Primary: { dish: 'Plain Rice + Baigan Masala + Dal Palak + Chapati', isHoliday: false },
      Secondary: { dish: 'Plain Rice + Baigan Masala + Dal Palak + Chapati', isHoliday: false },
    },
  },
  {
    date: '2026-10-10',
    displayDate: '10/10/2026',
    day: 'Saturday',
    menus: {
      'Pre-primary': { dish: 'Holiday', isHoliday: true, holidayReason: 'Pre-primary Saturday Holiday' },
      Primary: { dish: 'Veg Hyderabadi + Chapati + Rice', isHoliday: false },
      Secondary: { dish: 'Veg Hyderabadi + Chapati + Rice', isHoliday: false },
    },
  },
  {
    date: '2026-10-11',
    displayDate: '11/10/2026',
    day: 'Sunday',
    menus: {
      'Pre-primary': { dish: 'Holiday', isHoliday: true, holidayReason: 'Sunday Holiday' },
      Primary: { dish: 'Holiday', isHoliday: true, holidayReason: 'Sunday Holiday' },
      Secondary: { dish: 'Holiday', isHoliday: true, holidayReason: 'Sunday Holiday' },
    },
  },
  {
    date: '2026-10-12',
    displayDate: '12/10/2026',
    day: 'Monday',
    menus: {
      'Pre-primary': { dish: 'Tadka Rice + Dal Makhani + Chapati', isHoliday: false },
      Primary: { dish: 'Tadka Rice + Dal Makhani + Chapati', isHoliday: false },
      Secondary: { dish: 'Tadka Rice + Dal Makhani + Chapati', isHoliday: false },
    },
  },
  {
    date: '2026-10-13',
    displayDate: '13/10/2026',
    day: 'Tuesday',
    menus: {
      'Pre-primary': { dish: 'Mix Veg + Dal + Chapati + Rice', isHoliday: false },
      Primary: { dish: 'Mix Veg + Dal + Chapati + Rice', isHoliday: false },
      Secondary: { dish: 'Mix Veg + Dal + Chapati + Rice', isHoliday: false },
    },
  },
  {
    date: '2026-10-14',
    displayDate: '14/10/2026',
    day: 'Wednesday',
    menus: {
      'Pre-primary': { dish: 'Plain Rice + Soyabean Masala + Chapati + Salad', isHoliday: false },
      Primary: { dish: 'Plain Rice + Soyabean Masala + Chapati + Salad', isHoliday: false },
      Secondary: { dish: 'Plain Rice + Soyabean Masala + Chapati + Salad', isHoliday: false },
    },
  },
  {
    date: '2026-10-15',
    displayDate: '15/10/2026',
    day: 'Thursday',
    menus: {
      'Pre-primary': { dish: 'Mushroom Matar + Dal + Chapati + Rice', isHoliday: false },
      Primary: { dish: 'Mushroom Matar + Dal + Chapati + Rice', isHoliday: false },
      Secondary: { dish: 'Mushroom Matar + Dal + Chapati + Rice', isHoliday: false },
    },
  },
  {
    date: '2026-10-16',
    displayDate: '16/10/2026',
    day: 'Friday',
    menus: {
      'Pre-primary': { dish: 'Rice + Corn Matter Palak + Waran + Chapati', isHoliday: false },
      Primary: { dish: 'Rice + Corn Matter Palak + Waran + Chapati', isHoliday: false },
      Secondary: { dish: 'Rice + Corn Matter Palak + Waran + Chapati', isHoliday: false },
    },
  },
  {
    date: '2026-10-17',
    displayDate: '17/10/2026',
    day: 'Saturday',
    menus: {
      'Pre-primary': { dish: 'Holiday', isHoliday: true, holidayReason: 'Saturday Holiday' },
      Primary: { dish: 'Holiday', isHoliday: true, holidayReason: 'Saturday Holiday' },
      Secondary: { dish: 'Holiday', isHoliday: true, holidayReason: 'Saturday Holiday' },
    },
  },
  {
    date: '2026-10-18',
    displayDate: '18/10/2026',
    day: 'Sunday',
    menus: {
      'Pre-primary': { dish: 'Holiday', isHoliday: true, holidayReason: 'Sunday Holiday' },
      Primary: { dish: 'Holiday', isHoliday: true, holidayReason: 'Sunday Holiday' },
      Secondary: { dish: 'Holiday', isHoliday: true, holidayReason: 'Sunday Holiday' },
    },
  },
  {
    date: '2026-10-19',
    displayDate: '19/10/2026',
    day: 'Monday',
    menus: {
      'Pre-primary': { dish: 'Jeera Rice + Chole Bhaji + Chapati + Salad', isHoliday: false },
      Primary: { dish: 'Jeera Rice + Chole Bhaji + Chapati + Salad', isHoliday: false },
      Secondary: { dish: 'Jeera Rice + Chole Bhaji + Chapati + Salad', isHoliday: false },
    },
  },
  {
    date: '2026-10-20',
    displayDate: '20/10/2026',
    day: 'Tuesday',
    menus: {
      'Pre-primary': { dish: 'Dasara Holiday', isHoliday: true, holidayReason: 'Dasara Holiday' },
      Primary: { dish: 'Dasara Holiday', isHoliday: true, holidayReason: 'Dasara Holiday' },
      Secondary: { dish: 'Dasara Holiday', isHoliday: true, holidayReason: 'Dasara Holiday' },
    },
  },
  {
    date: '2026-10-21',
    displayDate: '21/10/2026',
    day: 'Wednesday',
    menus: {
      'Pre-primary': { dish: 'Mix Sprout + Dal + Chapati + Rice', isHoliday: false },
      Primary: { dish: 'Mix Sprout + Dal + Chapati + Rice', isHoliday: false },
      Secondary: { dish: 'Mix Sprout + Dal + Chapati + Rice', isHoliday: false },
    },
  },
  {
    date: '2026-10-22',
    displayDate: '22/10/2026',
    day: 'Thursday',
    menus: {
      'Pre-primary': { dish: 'Paneer Do Pyaza + Dal Lasuni + Rice + Chapati', isHoliday: false },
      Primary: { dish: 'Paneer Do Pyaza + Dal Lasuni + Rice + Chapati', isHoliday: false },
      Secondary: { dish: 'Paneer Do Pyaza + Dal Lasuni + Rice + Chapati', isHoliday: false },
    },
  },
  {
    date: '2026-10-23',
    displayDate: '23/10/2026',
    day: 'Friday',
    menus: {
      'Pre-primary': { dish: 'Gobi Mutter Dry + Masoor Dal + Chapati + Rice', isHoliday: false },
      Primary: { dish: 'Gobi Mutter Dry + Masoor Dal + Chapati + Rice', isHoliday: false },
      Secondary: { dish: 'Gobi Mutter Dry + Masoor Dal + Chapati + Rice', isHoliday: false },
    },
  },
  {
    date: '2026-10-24',
    displayDate: '24/10/2026',
    day: 'Saturday',
    menus: {
      'Pre-primary': { dish: 'Holiday', isHoliday: true, holidayReason: 'Pre-primary Saturday Holiday' },
      Primary: { dish: 'Lauki Chana + Dal + Chapati + Rice + Pickle', isHoliday: false },
      Secondary: { dish: 'Lauki Chana + Dal + Chapati + Rice + Pickle', isHoliday: false },
    },
  },
  {
    date: '2026-10-25',
    displayDate: '25/10/2026',
    day: 'Sunday',
    menus: {
      'Pre-primary': { dish: 'Holiday', isHoliday: true, holidayReason: 'Sunday Holiday' },
      Primary: { dish: 'Holiday', isHoliday: true, holidayReason: 'Sunday Holiday' },
      Secondary: { dish: 'Holiday', isHoliday: true, holidayReason: 'Sunday Holiday' },
    },
  },
  {
    date: '2026-10-26',
    displayDate: '26/10/2026',
    day: 'Monday',
    menus: {
      'Pre-primary': { dish: 'Idli + Sambar + Chutney', isHoliday: false },
      Primary: { dish: 'Idli + Sambar + Chutney', isHoliday: false },
      Secondary: { dish: 'Idli + Sambar + Chutney', isHoliday: false },
    },
  },
  {
    date: '2026-10-27',
    displayDate: '27/10/2026',
    day: 'Tuesday',
    menus: {
      'Pre-primary': { dish: 'Aloo Paratha + Pulav + Curd + Sweet', isHoliday: false },
      Primary: { dish: 'Aloo Paratha + Pulav + Curd + Sweet', isHoliday: false },
      Secondary: { dish: 'Aloo Paratha + Pulav + Curd + Sweet', isHoliday: false },
    },
  },
  {
    date: '2026-10-28',
    displayDate: '28/10/2026',
    day: 'Wednesday',
    menus: {
      'Pre-primary': { dish: 'Rajma + Dal + Chapati + Rice', isHoliday: false },
      Primary: { dish: 'Rajma + Dal + Chapati + Rice', isHoliday: false },
      Secondary: { dish: 'Rajma + Dal + Chapati + Rice', isHoliday: false },
    },
  },
  {
    date: '2026-10-29',
    displayDate: '29/10/2026',
    day: 'Thursday',
    menus: {
      'Pre-primary': { dish: 'Veg Cutlet (Shallow fry) + Banana', isHoliday: false },
      Primary: { dish: 'Green Moong + Dal + Chapati + Rice', isHoliday: false },
      Secondary: { dish: 'Green Moong + Dal + Chapati + Rice', isHoliday: false },
    },
  },
  {
    date: '2026-10-30',
    displayDate: '30/10/2026',
    day: 'Friday',
    menus: {
      'Pre-primary': { dish: 'Dosa Bhaji + Dal Palak + Rice + Chapati + Salad', isHoliday: false },
      Primary: { dish: 'Dosa Bhaji + Dal Palak + Rice + Chapati + Salad', isHoliday: false },
      Secondary: { dish: 'Dosa Bhaji + Dal Palak + Rice + Chapati + Salad', isHoliday: false },
    },
  },
  {
    date: '2026-10-31',
    displayDate: '31/10/2026',
    day: 'Saturday',
    menus: {
      'Pre-primary': { dish: 'Holiday', isHoliday: true, holidayReason: 'Pre-primary Saturday Holiday' },
      Primary: { dish: 'Mix Veg Paratha + Curd + Dalkhichadi', isHoliday: false },
      Secondary: { dish: 'Mix Veg Paratha + Curd + Dalkhichadi', isHoliday: false },
    },
  },
];

const dishNameToMealIdMap = new Map<string, string>();
OCTOBER_2026_MEAL_CATALOG.forEach((meal) => {
  dishNameToMealIdMap.set(meal.name.toLowerCase().trim(), meal.id);
});

export function getMealIdForDish(dishName: string): string {
  const clean = dishName.toLowerCase().trim();
  const found = dishNameToMealIdMap.get(clean);
  if (found) return found;
  if (clean.includes('holiday')) return 'meal_holiday_no_brunch';
  return 'meal_oct_mix_veg_dal_chapati_rice';
}

/**
 * Normalizes grade string or explicit category to 'Pre-primary' | 'Primary' | 'Secondary'
 */
export function getStudentCategory(
  grade?: string | null,
  explicitCategory?: string | null
): StudentCategory {
  if (explicitCategory) {
    const clean = explicitCategory.trim().toLowerCase();
    if (clean.includes('pre')) return 'Pre-primary';
    if (clean.includes('secondary')) return 'Secondary';
    if (clean.includes('primary')) return 'Primary';
  }

  if (!grade) return 'Primary';
  const g = grade.trim().toLowerCase();

  // Kindergarten / Nursery / Pre-primary checks
  if (
    g.includes('nursery') ||
    g.includes('kg') ||
    g.includes('lkg') ||
    g.includes('ukg') ||
    g.includes('pre') ||
    g.includes('kindergarten') ||
    g === '0'
  ) {
    return 'Pre-primary';
  }

  const num = parseInt(g.replace(/\D/g, ''), 10);
  if (!isNaN(num)) {
    if (num <= 5) return 'Primary';
    return 'Secondary';
  }

  return 'Primary';
}

export function getTimetableForDateAndCategory(
  dateStr: string,
  category: StudentCategory
): { dish: string; isHoliday: boolean; holidayReason?: string; day: string } | null {
  const dayEntry = OCTOBER_2026_TIMETABLE.find((d) => d.date === dateStr);
  if (!dayEntry) return null;
  const catMenu = dayEntry.menus[category] || dayEntry.menus.Primary;
  return {
    dish: catMenu.dish,
    isHoliday: catMenu.isHoliday,
    holidayReason: catMenu.holidayReason,
    day: dayEntry.day,
  };
}
