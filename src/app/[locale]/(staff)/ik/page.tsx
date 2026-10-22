import { Suspense } from "react";
import { StaffHome } from "@/components/hr/staff-home";

export default function HrHomePage() {
  return (
    <Suspense>
      <StaffHome />
    </Suspense>
  );
}
