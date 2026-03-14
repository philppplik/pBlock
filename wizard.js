// pBlock - First Run Wizard

let currentStep = 1;
const totalSteps = 4;
let selectedLevel = 'simple';

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupLevelSelection();
});

function setupNavigation() {
  const nextBtn = document.getElementById('wizard-next');
  const prevBtn = document.getElementById('wizard-prev');

  nextBtn.addEventListener('click', () => {
    if (currentStep < totalSteps) {
      goToStep(currentStep + 1);
    } else {
      finishWizard();
    }
  });

  prevBtn.addEventListener('click', () => {
    if (currentStep > 1) {
      goToStep(currentStep - 1);
    }
  });
}

function setupLevelSelection() {
  document.querySelectorAll('.level-option').forEach(option => {
    option.addEventListener('click', () => {
      document.querySelectorAll('.level-option').forEach(o => o.classList.remove('selected'));
      option.classList.add('selected');
      option.querySelector('input').checked = true;
      selectedLevel = option.dataset.level;
    });
  });
}

function goToStep(step) {
  // Hide current step
  document.getElementById(`step-${currentStep}`).classList.remove('active');

  // Show new step
  currentStep = step;
  document.getElementById(`step-${currentStep}`).classList.add('active');

  // Update progress dots
  document.querySelectorAll('.progress-dot').forEach(dot => {
    const dotStep = parseInt(dot.dataset.step);
    dot.classList.remove('active', 'done');
    if (dotStep === currentStep) {
      dot.classList.add('active');
    } else if (dotStep < currentStep) {
      dot.classList.add('done');
    }
  });

  // Update buttons
  const nextBtn = document.getElementById('wizard-next');
  const prevBtn = document.getElementById('wizard-prev');

  prevBtn.style.display = currentStep > 1 ? 'inline-flex' : 'none';

  if (currentStep === totalSteps) {
    nextBtn.textContent = 'Fertig';
  } else {
    nextBtn.textContent = 'Weiter';
  }
}

async function finishWizard() {
  // Save settings
  chrome.runtime.sendMessage({
    type: 'setFilterLevel',
    level: selectedLevel
  });

  chrome.runtime.sendMessage({
    type: 'toggle',
    enabled: true
  });

  // Mark wizard as completed
  await chrome.storage.local.set({ wizardCompleted: true });

  // Close wizard and open options
  chrome.runtime.openOptionsPage();
  window.close();
}
