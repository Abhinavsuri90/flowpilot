import type { Role } from './types'

/** The synthetic demo people. Seeded by the server; listed on the sign-in page. */
export const DEMO_PEOPLE = [
  {
    key: 'asha',
    email: 'asha@demo.local',
    name: 'Asha Rao',
    hue: 248,
    workspace: 'Sales',
    role: 'admin',
    purpose: 'Creates and shares the demo recipe',
  },
  {
    key: 'vikram',
    email: 'vikram@demo.local',
    name: 'Vikram Nair',
    hue: 172,
    workspace: 'Sales',
    role: 'member',
    purpose: 'Reruns it on a new file, then makes a copy',
  },
  {
    key: 'meera',
    email: 'meera@demo.local',
    name: 'Meera Iyer',
    hue: 330,
    workspace: 'Sales',
    role: 'viewer',
    purpose: 'Can run recipes, cannot copy or create',
  },
  {
    key: 'olivia',
    email: 'olivia@demo.local',
    name: 'Olivia Chen',
    hue: 28,
    workspace: 'Marketing',
    role: 'admin',
    purpose: 'Outsider to Sales: sees none of it',
  },
] as const satisfies ReadonlyArray<{
  key: string
  email: string
  name: string
  hue: number
  workspace: 'Sales' | 'Marketing'
  role: Role
  purpose: string
}>

export type DemoKey = (typeof DEMO_PEOPLE)[number]['key']
