// The drop inventory. Edit freely — this is a config knob.
// Desirability is deliberately skewed: ~2 top-tier, most mid, one cursed.
// tier: 'S' | 'A' | 'B' | 'cursed'
export const ITEMS = [
  { menu_no: 1,  name: 'Chili Mac',            nsn: '8970-01-E23-4571', tier: 'S' },
  { menu_no: 2,  name: 'Beef Ravioli',         nsn: '8970-01-C88-1092', tier: 'S' },
  { menu_no: 4,  name: 'Spaghetti w/ Beef',    nsn: '8970-01-F41-7738', tier: 'A' },
  { menu_no: 8,  name: 'Meatballs Marinara',   nsn: '8970-01-A19-3350', tier: 'A' },
  { menu_no: 11, name: 'Cheese Tortellini',    nsn: '8970-01-D57-6614', tier: 'B' },
  { menu_no: 14, name: 'Pepper Jack Beef Patty', nsn: '8970-01-B72-9903', tier: 'B' },
  { menu_no: 21, name: 'Vegetarian Omelette',  nsn: '8970-01-X66-0666', tier: 'cursed' },
];
