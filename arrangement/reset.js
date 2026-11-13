document.addEventListener('keydown', event => {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.code !== 'KeyR' && event.key.toLowerCase() !== 'r') return;
  event.preventDefault();
  window.location.reload();
});
