// The admin destinations, shared by the desktop sidebar's Admin section and the
// mobile Admin menu so the two can't drift apart. Adding a page here puts it in
// both places at once.
//
// `description` is only shown on the mobile menu, where there is room for it.
export const ADMIN_ITEMS = [
  {
    to: '/users',
    label: 'Users',
    icon: '👤',
    description: 'Team logins, roles, billing rates and diary colours',
  },
  {
    to: '/presenter/admin',
    label: 'Presenter Setup',
    icon: '🎛',
    description: 'Products, categories and calculators in the Sales Presenter',
  },
  {
    to: '/website',
    label: 'Website',
    icon: '🌐',
    description: 'Preview and publish dekkerair.co.nz, deals and pricing',
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: '⚙',
    description: 'Job types, statuses, document themes, forms and integrations',
  },
];
