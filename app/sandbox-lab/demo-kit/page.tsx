import { notFound } from 'next/navigation';

import DemoKitLab from './demo-kit-lab';

export const dynamic = 'force-dynamic';

/** Developer fixture page for the demo kit, behind the same flag as the sandbox lab. */
export default function DemoKitLabPage() {
  if (process.env.OPENMAIC_SANDBOX_LAB !== 'true') notFound();
  return <DemoKitLab />;
}
