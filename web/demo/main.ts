// Demo entry: install the stand-in gateway and sample camera, then start the
// real application untouched.
import {installMockGateway, installSampleCamera} from './mock-gateway';

installMockGateway();
try {installSampleCamera();} catch {/* a host that forbids it still gets the real permission message */}

void import('../src/main').then(() => {
  // Open on the supplier comparison rather than a camera that is off: the first
  // frame should show what the employee does, not an empty viewfinder. This
  // clicks the app's own tab, so nothing about the app is special-cased.
  const openTasks = () => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find(t => t.textContent === 'Tasks') as HTMLButtonElement | undefined;
    if (tab) tab.click();
    else requestAnimationFrame(openTasks);
  };
  requestAnimationFrame(openTasks);
});
