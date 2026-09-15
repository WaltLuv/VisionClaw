// Demo entry: install the stand-in gateway and sample camera, then start the
// real application untouched. It opens where the app opens — the camera screen.
import {installMockGateway, installSampleCamera} from './mock-gateway';

installMockGateway();
try {installSampleCamera();} catch {/* a host that forbids it still gets the real permission message */}

void import('../src/main');
