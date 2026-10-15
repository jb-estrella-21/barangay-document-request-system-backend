import { StaffRole } from '@prisma/client';

export type StaffPrincipal = {
  id: string;
  username: string;
  role: StaffRole;
  mustChangePassword: boolean;
};
