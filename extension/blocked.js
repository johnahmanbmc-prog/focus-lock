const reason = new URLSearchParams(location.search).get('reason');
if (reason) document.getElementById('reason').textContent = reason;
