// Main page JavaScript - Room Creation
let currentRoom = null;

// DOM Elements
const createRoomBtn = document.getElementById('createRoomBtn');
const roomInfo = document.getElementById('roomInfo');
const roomUrl = document.getElementById('roomUrl');
const roomCode = document.getElementById('roomCode');
const copyUrlBtn = document.getElementById('copyUrlBtn');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const goToRoomBtn = document.getElementById('goToRoomBtn');
const createAnotherBtn = document.getElementById('createAnotherBtn');
const errorDiv = document.getElementById('errorDiv');
const shareEmail = document.getElementById('shareEmail');
const shareWhatsApp = document.getElementById('shareWhatsApp');
const shareTelegram = document.getElementById('shareTelegram');
const shareCopy = document.getElementById('shareCopy');

// Create new room
createRoomBtn.addEventListener('click', async () => {
    try {
        createRoomBtn.disabled = true;
        createRoomBtn.textContent = '⏳ Creating...';

        const response = await fetch('/api/rooms', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            currentRoom = data;
            showRoomInfo(data);
            showToast('Room created successfully!', 'success');
        } else {
            showError('Failed to create room');
        }
    } catch (error) {
        console.error('Error creating room:', error);
        showError('Network error. Please try again.');
    } finally {
        createRoomBtn.disabled = false;
        createRoomBtn.textContent = '🔗 Create New Room';
    }
});

// Show room information
function showRoomInfo(room) {
    roomUrl.value = room.url;
    roomCode.value = room.roomId;
    roomInfo.style.display = 'block';
    goToRoomBtn.style.display = 'inline-block';
    errorDiv.style.display = 'none';
}

// Copy functionality with fallback
async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        } else {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const success = document.execCommand('copy');
            document.body.removeChild(textArea);
            return success;
        }
    } catch (err) {
        console.error('Copy failed:', err);
        return false;
    }
}

copyUrlBtn.addEventListener('click', async () => {
    const success = await copyToClipboard(roomUrl.value);
    showToast(success ? 'Room URL copied!' : 'Failed to copy URL', success ? 'success' : 'error');
});

copyCodeBtn.addEventListener('click', async () => {
    const success = await copyToClipboard(roomCode.value);
    showToast(success ? 'Room code copied!' : 'Failed to copy code', success ? 'success' : 'error');
});

// Go to room
goToRoomBtn.addEventListener('click', () => {
    if (currentRoom) {
        window.location.href = currentRoom.url;
    }
});

// Create another room
createAnotherBtn.addEventListener('click', () => {
    roomInfo.style.display = 'none';
    errorDiv.style.display = 'none';
    roomUrl.value = '';
    roomCode.value = '';
    currentRoom = null;
    showToast('Ready to create a new room', 'info');
});

// Sharing options with better error handling
shareEmail.addEventListener('click', () => {
    try {
        const subject = encodeURIComponent('Join my file transfer room');
        const body = encodeURIComponent(`Hi! Join my file transfer room using this link: ${roomUrl.value}`);
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
    } catch (e) {
        showToast('Failed to open email client', 'error');
    }
});

shareWhatsApp.addEventListener('click', () => {
    try {
        const text = encodeURIComponent(`Join my file transfer room: ${roomUrl.value}`);
        window.open(`https://wa.me/?text=${text}`, '_blank');
    } catch (e) {
        showToast('Failed to open WhatsApp', 'error');
    }
});

shareTelegram.addEventListener('click', () => {
    try {
        const text = encodeURIComponent(`Join my file transfer room: ${roomUrl.value}`);
        window.open(`https://t.me/share/url?url=${encodeURIComponent(roomUrl.value)}&text=${text}`, '_blank');
    } catch (e) {
        showToast('Failed to open Telegram', 'error');
    }
});

shareCopy.addEventListener('click', async () => {
    const text = `File Transfer Room\nCode: ${roomCode.value}\nURL: ${roomUrl.value}`;
    const success = await copyToClipboard(text);
    showToast(success ? 'Room details copied!' : 'Failed to copy details', success ? 'success' : 'error');
});

// Error handling
function showError(message) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    showToast(message, 'error');
}

// Toast notifications with better positioning
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `notification ${type}`;
    toast.textContent = message;

    const notifications = document.querySelector('.notifications');
    if (notifications) {
        notifications.appendChild(toast);
    } else {
        // Fallback: add to body
        document.body.appendChild(toast);
        toast.style.position = 'fixed';
        toast.style.top = '20px';
        toast.style.right = '20px';
    }

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Keyboard shortcuts with error handling
document.addEventListener('keydown', (e) => {
    try {
        if (e.ctrlKey && e.key === 'Enter') {
            createRoomBtn.click();
        }
    } catch (err) {
        console.error('Keyboard shortcut error:', err);
    }
});

// Page load animation with feature detection
document.addEventListener('DOMContentLoaded', () => {
    try {
        if ('animate' in document.body) {
            document.body.animate([
                { opacity: 0 },
                { opacity: 1 }
            ], {
                duration: 500,
                fill: 'forwards'
            });
        }
    } catch (e) {
        // Animation not supported, just show the page
        document.body.style.opacity = '1';
    }
});

// Browser compatibility check
function checkBrowserCompatibility() {
    const features = {
        fetch: typeof fetch !== 'undefined',
        localStorage: typeof localStorage !== 'undefined',
        promises: typeof Promise !== 'undefined',
        json: typeof JSON !== 'undefined'
    };

    const supported = Object.values(features).every(v => v);
    if (!supported) {
        showToast('Your browser may not support all features. Please update to the latest version.', 'warning');
    }

    return supported;
}

// Check compatibility on load
checkBrowserCompatibility();