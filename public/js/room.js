// Room page JavaScript - File Transfer Logic
const socket = io();
let roomId = null;
let currentFiles = new Map();
let uploadPromises = new Map();

// DOM Elements
const roomIdDisplay = document.getElementById('roomIdDisplay');
const userCount = document.getElementById('userCount');
const fileList = document.getElementById('fileList');
const fileCount = document.getElementById('fileCount');
const notifications = document.getElementById('notifications');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const shareUrl = document.getElementById('shareUrl');
const refreshBtn = document.getElementById('refreshBtn');
const maxFileSize = document.getElementById('maxFileSize');

// QR Code Elements - 初始化时不获取，避免null
let qrCodeImage, qrUrlInput, copyQrUrlBtn, downloadQrBtn, refreshQrBtn;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Get room ID from URL
    roomId = getRoomIdFromUrl();
    if (!roomId) {
        showToast('Invalid room URL', 'error');
        return;
    }

    roomIdDisplay.textContent = roomId;

    // Set share URL
    shareUrl.textContent = window.location.href;

    // Set max file size with fallback
    const maxFileSizeBytes = getMaxFileSize();
    maxFileSize.textContent = formatFileSize(maxFileSizeBytes);

    // Check feature support
    if (!checkBrowserSupport()) {
        showToast('Your browser may not support all features. Please update to the latest version.', 'warning');
    }

    // Join room
    socket.emit('join-room', roomId);

    // Event listeners
    setupEventListeners();

    // Handle page visibility
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            refreshFileList();
        }
    });

    // Handle beforeunload
    window.addEventListener('beforeunload', () => {
        socket.emit('leave-room', roomId);
    });

    // Initial file list refresh
    setTimeout(refreshFileList, 1000);

    // Initialize QR Code elements and setup after DOM is ready
    initializeQRCode();
});

// Setup event listeners
function setupEventListeners() {
    // Upload area interactions
    dropZone.addEventListener('click', () => fileInput.click());
    browseBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // 阻止事件冒泡，避免触发dropZone的click事件
        fileInput.click();
    });

    // 防止浏览器默认的拖拽行为
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFiles(files);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFiles(e.target.files);
            fileInput.value = ''; // Reset input
        }
    });

    refreshBtn.addEventListener('click', refreshFileList);

    // QR Code buttons
    if (copyQrUrlBtn) {
        copyQrUrlBtn.addEventListener('click', async () => {
            try {
                await copyToClipboard(qrUrlInput.value);
                showToast('Room URL copied to clipboard', 'success');
            } catch (error) {
                showToast('Failed to copy URL', 'error');
            }
        });
    }

    if (downloadQrBtn) {
        downloadQrBtn.addEventListener('click', downloadQRCode);
    }

    if (refreshQrBtn) {
        refreshQrBtn.addEventListener('click', setupQRCode);
    }

    // Clipboard paste support
    setupClipboardSupport();

    // Socket events
    socket.on('room-joined', (data) => {
        updateUserInfo(data.userCount);
        showToast('Joined room successfully', 'success');
    });

    socket.on('user-joined', (data) => {
        updateUserInfo(data.userCount);
        showToast('New user joined the room', 'info');
    });

    socket.on('user-left', (data) => {
        updateUserInfo(data.userCount);
        showToast('User left the room', 'info');
    });

    socket.on('file-added', (fileData) => {
        // Check if this file was uploaded by the current user
        // If so, don't add it again (already added in uploadFile)
        if (fileData.uploadedBy === socket.id) {
            console.log('Skipping file-added event for own upload:', fileData.name);
            return;
        }

        addFileToList(fileData);
        showToast(`New file: ${fileData.name}`, 'info');
    });

    socket.on('file-progress', (progressData) => {
        updateFileProgress(progressData.fileId, progressData.progress);
    });

    socket.on('file-completed', (fileData) => {
        console.log('✅ socket file-completed received:', fileData.name);
        console.log('✅ socket file-completed URL:', fileData.url);
        console.log('✅ socket file-completed status:', fileData.status);
        completeFileUpload(fileData);
        showToast(`Upload completed: ${fileData.name}`, 'success');
    });

    socket.on('file-error', (errorData) => {
        showErrorOnFile(errorData.fileId, errorData.error);
        showToast(`Upload failed: ${errorData.error}`, 'error');
    });
}

// Get room ID from URL
function getRoomIdFromUrl() {
    const path = window.location.pathname;
    const match = path.match(/\/room\/(.+)/);
    return match ? match[1] : null;
}

// Update user count
function updateUserInfo(count) {
    userCount.textContent = count;
}

// Handle file selection
async function handleFiles(files) {
    if (!roomId) return;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await uploadFile(file);
    }
}

// Upload file
// Validate file
function validateFile(file) {
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
        showToast(`File too large: ${file.name}`, 'error');
        return false;
    }
    return true;
}

// Start file upload
async function startFileUpload(file, fileId) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);

        const xhr = new XMLHttpRequest();

        // Notify server about upload start
        socket.emit('file-upload-start', {
            roomId: roomId,
            file: {
                name: file.name,
                size: file.size,
                type: file.type
            }
        });

        // Progress tracking
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const progress = Math.round((e.loaded / e.total) * 100);
                socket.emit('file-upload-progress', {
                    fileId: fileId,
                    progress: progress
                });
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status === 200) {
                const response = JSON.parse(xhr.responseText);
                if (response.success) {
                    socket.emit('file-upload-complete', {
                        fileId: fileId,
                        fileUrl: response.fileUrl
                    });
                    resolve({
                        success: true,
                        fileUrl: response.fileUrl
                    });
                } else {
                    socket.emit('file-upload-error', {
                        fileId: fileId,
                        error: response.message || 'Upload failed'
                    });
                    reject(new Error(response.message || 'Upload failed'));
                }
            } else {
                const error = xhr.responseText || 'HTTP Error';
                socket.emit('file-upload-error', {
                    fileId: fileId,
                    error: error
                });
                reject(new Error(error));
            }
        });

        xhr.addEventListener('error', () => {
            socket.emit('file-upload-error', {
                fileId: fileId,
                error: 'Network error'
            });
            reject(new Error('Network error'));
        });

        xhr.open('POST', `/api/upload/${roomId}`);
        xhr.send(formData);
    });
}

// Add file to list
function addFileToList(fileData) {
    console.log('📝 addFileToList called for:', fileData.name, 'ID:', fileData.id, 'Status:', fileData.status);
    currentFiles.set(fileData.id, { ...fileData });

    const fileElement = createFileElement(fileData);
    fileList.appendChild(fileElement);

    updateFileCount();
    showEmptyState();
}


// Update file progress
function updateFileProgress(fileId, progress) {
    const fileData = currentFiles.get(fileId);
    if (!fileData) return;

    fileData.progress = progress;
    currentFiles.set(fileId, fileData);

    const fileElement = document.querySelector(`.file-item[data-file-id="${fileId}"]`);
    if (fileElement) {
        const progressFill = fileElement.querySelector('.progress-fill');
        const statusText = fileElement.querySelector('.file-status');

        if (progressFill) {
            progressFill.style.width = `${progress}%`;
        }

        if (statusText) {
            statusText.textContent = `Uploading: ${progress}%`;
        }
    }
}

// Complete file upload
function completeFileUpload(fileData) {
    console.log('✅ completeFileUpload called for:', fileData.name, 'ID:', fileData.id);
    console.log('✅ File URL:', fileData.url);
    console.log('✅ File status:', fileData.status);

    const existing = currentFiles.get(fileData.id);
    if (!existing) return;

    // Merge existing data with new data, ensuring status and progress are correct
    const updatedFileData = {
        ...existing,
        ...fileData,
        // Override status and progress to ensure they're correct
        status: 'completed',
        progress: fileData.progress || 100
    };

    currentFiles.set(fileData.id, updatedFileData);

    const fileElement = document.querySelector(`.file-item[data-file-id="${fileData.id}"]`);
    if (fileElement) {
        fileElement.classList.remove('uploading');
        fileElement.classList.add('completed');

        const statusText = fileElement.querySelector('.file-status');
        const downloadBtn = fileElement.querySelector('.btn-download');

        if (statusText) {
            statusText.textContent = '✅ Upload completed';
        }

        if (downloadBtn) {
            downloadBtn.disabled = false;
            console.log('✅ Download button enabled for:', fileData.name);
        }

        // 如果是文本文件且有预览内容，更新预览
        const type = (fileData.type || '').toLowerCase();
        if ((type.startsWith('text/') || isTextFile(fileData.name)) && fileData.textContent) {
            updateInlineTextPreview(fileData.id, fileData.textContent, 2);
        }

        // 重要：如果文件卡片还没有预览内容，现在添加
        const hasPreviewContent = fileElement.querySelector('.content-preview');
        if (!hasPreviewContent) {
            const contentPreview = createContentPreview(updatedFileData);
            if (contentPreview) {
                fileElement.appendChild(contentPreview);
            }
        }
    }
}

// Show error on file
function showErrorOnFile(fileId, error) {
    const fileElement = document.querySelector(`.file-item[data-file-id="${fileId}"]`);
    if (fileElement) {
        fileElement.classList.remove('uploading');
        fileElement.classList.add('error');

        const statusText = fileElement.querySelector('.file-status');
        const downloadBtn = fileElement.querySelector('.btn-download');

        if (statusText) {
            statusText.textContent = `❌ Error: ${error}`;
        }

        if (downloadBtn) {
            downloadBtn.disabled = true;
        }
    }
}

// Cancel upload
function cancelUpload(fileId) {
    const uploadPromise = uploadPromises.get(fileId);
    if (uploadPromise && uploadPromise.cancel) {
        uploadPromise.cancel();
    }

    // Remove from UI
    const fileElement = document.querySelector(`.file-item[data-file-id="${fileId}"]`);
    if (fileElement) {
        fileElement.remove();
    }

    currentFiles.delete(fileId);
    uploadPromises.delete(fileId);
    updateFileCount();
    showEmptyState();
}

// Download file
function downloadFile(fileData) {
    const link = document.createElement('a');
    link.href = fileData.url;
    link.download = fileData.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Refresh file list
async function refreshFileList() {
    try {
        const response = await fetch(`/api/rooms/${roomId}`);
        const data = await response.json();

        if (data.success) {
            updateUserInfo(data.userCount);
        }
    } catch (error) {
        console.error('Refresh error:', error);
    }
}

// Utility functions
function getFileIcon(fileType) {
    if (fileType.startsWith('image/')) return '🖼️';
    if (fileType.startsWith('video/')) return '🎥';
    if (fileType.startsWith('audio/')) return '🎵';
    if (fileType.includes('pdf')) return '📄';
    if (fileType.includes('document') || fileType.includes('word')) return '📝';
    if (fileType.includes('archive') || fileType.includes('zip')) return '🗜️';
    if (fileType.includes('text')) return '🗒️';
    return '📁';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getStatusText(fileData) {
    switch (fileData.status) {
        case 'uploading':
            return `Uploading: ${fileData.progress || 0}%`;
        case 'completed':
            return '✅ Upload completed';
        case 'error':
            return '❌ Upload failed';
        default:
            return 'Waiting...';
    }
}

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

function updateFileCount() {
    fileCount.textContent = currentFiles.size;
}

function showEmptyState() {
    const hasFiles = currentFiles.size > 0;
    const emptyState = document.querySelector('.empty-state');

    if (hasFiles && emptyState) {
        emptyState.style.display = 'none';
    } else if (!hasFiles && !emptyState) {
        const emptyHTML = `
            <div class="empty-state">
                <div class="empty-icon">📭</div>
                <h3>No files yet</h3>
                <p>Upload your first file or wait for others to upload</p>
            </div>
        `;
        fileList.innerHTML = emptyHTML;
    }
}

// Toast notifications
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `notification ${type}`;
    toast.textContent = message;

    notifications.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Utility functions - Browser compatibility optimized
function getFileIcon(fileType) {
    if (!fileType) return '📁';

    const type = fileType.toLowerCase();
    if (type.startsWith('image/')) return '🖼️';
    if (type.startsWith('video/')) return '🎥';
    if (type.startsWith('audio/')) return '🎵';

    const ext = type.split('/').pop() || '';
    if (ext.includes('pdf')) return '📄';
    if (ext.includes('document') || ext.includes('word') || ext.includes('msword')) return '📝';
    if (ext.includes('archive') || ext.includes('zip') || ext.includes('rar') || ext.includes('7z')) return '🗜️';
    if (ext.includes('text') || ext.includes('plain')) return '🗒️';
    if (ext.includes('excel') || ext.includes('spreadsheet')) return '📊';
    if (ext.includes('powerpoint') || ext.includes('presentation')) return '📽️';

    return '📁';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    if (!bytes) return 'Unknown size';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const size = parseFloat((bytes / Math.pow(k, i)).toFixed(2));

    return size + ' ' + sizes[i];
}

function getStatusText(fileData) {
    if (!fileData) return 'Unknown status';

    switch (fileData.status) {
        case 'uploading':
            return `Uploading: ${fileData.progress || 0}%`;
        case 'completed':
            return '✅ Upload completed';
        case 'error':
            return `❌ ${fileData.error || 'Upload failed'}`;
        default:
            return 'Waiting...';
    }
}

function generateId() {
    // Fallback for older browsers
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const array = new Uint32Array(3);
        crypto.getRandomValues(array);
        return Array.from(array).map(n => n.toString(36)).join('');
    }

    // Fallback method
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function updateFileCount() {
    fileCount.textContent = currentFiles ? currentFiles.size : 0;
}

function showEmptyState() {
    const hasFiles = currentFiles && currentFiles.size > 0;
    const emptyState = document.querySelector('.empty-state');

    if (hasFiles && emptyState) {
        emptyState.style.display = 'none';
    } else if (!hasFiles && !emptyState) {
        const emptyHTML = `
            <div class="empty-state">
                <div class="empty-icon">📭</div>
                <h3>No files yet</h3>
                <p>Upload your first file or wait for others to upload</p>
            </div>
        `;
        if (fileList) {
            fileList.innerHTML = emptyHTML;
        }
    }
}

// Browser compatibility functions
function getRoomIdFromUrl() {
    try {
        const path = window.location.pathname || '';
        const match = path.match(/\/room\/(.+)/);
        return match ? match[1] : null;
    } catch (e) {
        return null;
    }
}

function getMaxFileSize() {
    // Try to get from server config or use default
    return 50 * 1024 * 1024; // 50MB default
}

function checkBrowserSupport() {
    const features = {
        webSocket: 'WebSocket' in window,
        fetch: typeof fetch !== 'undefined',
        fileAPI: 'FileReader' in window && 'File' in window,
        dragAndDrop: 'draggable' in document.createElement('div'),
        localStorage: typeof localStorage !== 'undefined',
        canvas: !!document.createElement('canvas').getContext
    };

    const supportedCount = Object.values(features).filter(v => v).length;
    const totalCount = Object.keys(features).length;
    const compatibility = supportedCount / totalCount;

    return compatibility >= 0.6; // 60% or more features supported
}

// Event handling with better error handling
function addSafeEventListener(element, event, handler) {
    if (element && element.addEventListener) {
        element.addEventListener(event, handler);
    }
}

// Network status monitoring
function checkNetworkStatus() {
    if ('onLine' in navigator) {
        return navigator.onLine;
    }
    return true; // Assume online if can't determine
}

// Memory management
function cleanup() {
    // Clear file maps
    if (currentFiles) {
        currentFiles.clear();
    }

    // Cancel pending uploads
    if (uploadPromises) {
        uploadPromises.forEach(promise => {
            if (promise && typeof promise.cancel === 'function') {
                promise.cancel();
            }
        });
        uploadPromises.clear();
    }

    // Clear notifications
    if (notifications) {
        notifications.innerHTML = '';
    }
}

// Graceful error handling
function handleGlobalError(error) {
    console.error('Global error:', error);
    showToast('An unexpected error occurred. Please try refreshing the page.', 'error');
}

// Add error boundary
window.addEventListener('error', (event) => {
    handleGlobalError(event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    handleGlobalError(event.reason);
});

// Clipboard support functions
function setupClipboardSupport() {
    // 只添加一次事件监听器，防止重复
    document.removeEventListener('paste', handlePasteEvent);
    document.addEventListener('paste', handlePasteEvent);

    // Show paste hint
    showToast('📋 Paste support enabled! Try Ctrl+V (or Cmd+V) to paste files, images, or text', 'info');

    console.log('Clipboard paste support initialized');
}

// Debug: Log paste events
document.addEventListener('paste', (event) => {
    console.log('📋 Paste event detected!');
});

function handlePasteEvent(event) {
    const clipboardData = event.clipboardData || window.clipboardData;
    if (!clipboardData) return;

    const items = clipboardData.items;
    if (!items || items.length === 0) return;

    // 防止重复处理
    event.preventDefault();

    const files = [];
    const textItems = [];
    const imageItems = [];

    // 只处理第一个文本项，避免重复
    let textProcessed = false;
    let imageProcessed = false;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Handle files (from file manager)
        if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) {
                file.origin = 'file-manager';
                files.push(file);
            }
        }
        // Handle text (from text editor, web page, etc.)
        else if (item.kind === 'string' && !textProcessed) {
            item.origin = 'text'; // 标记为文本来源
            textItems.push(item);
            textProcessed = true;
        }
        // Handle images (from screenshots, image copy)
        else if (item.type && item.type.startsWith('image/') && !imageProcessed) {
            item.origin = 'image'; // 标记为图片来源
            imageItems.push(item);
            imageProcessed = true;
        }
    }

    // Process pasted content
    if (files.length > 0) {
        handleFiles(files);
        showToast(`Pasted ${files.length} file(s) from clipboard`, 'success');
    }

    if (imageItems.length > 0) {
        handlePastedImages(imageItems);
    }

    if (textItems.length > 0) {
        console.log('📋 Processing pasted text, count:', textItems.length);
        handlePastedText(textItems[0]); // 只处理第一个
    }
}

async function handlePastedImages(imageItems) {
    for (let i = 0; i < imageItems.length; i++) {
        const item = imageItems[i];

        try {
            const blob = await new Promise((resolve) => {
                const file = item.getAsFile();
                if (file) {
                    resolve(file);
                } else {
                    // Fallback: try to get blob
                    item.getAsString && item.getAsString((text) => {
                        resolve(text);
                    });
                }
            });

            if (blob && blob instanceof Blob) {
                // Convert image to file
                const fileName = `pasted-image-${Date.now()}-${i}.png`;
                const file = new File([blob], fileName, {
                    type: blob.type || 'image/png',
                    lastModified: Date.now()
                });

                handleFiles([file]);
                showToast('Pasted image from clipboard', 'success');
            }
        } catch (error) {
            console.error('Error handling pasted image:', error);
            showToast('Failed to paste image', 'error');
        }
    }
}

async function handlePastedText(textItem) {
    console.log('📋 handlePastedText called');
    try {
        const textPromise = new Promise((resolve) => {
            textItem.getAsString(resolve);
        });

        const text = await textPromise;

        if (text && text.trim()) {
            console.log('📋 Creating file from pasted text:', text.substring(0, 50) + '...');
            // Create text file from clipboard content
            const fileName = `pasted-text-${Date.now()}.txt`;
            const file = new File([text], fileName, {
                type: 'text/plain',
                lastModified: Date.now()
            });

            // 根据文本来源设置不同的origin
            if (textItem.origin === 'text') {
                file.origin = 'clipboard-text'; // 来自文本编辑器、网页等
            } else {
                file.origin = 'clipboard'; // 默认粘贴来源
            }

            // 直接上传文件
            console.log('📋 Calling handleFiles with file:', file.name);
            handleFiles([file]);
            showToast('Pasted text as file from clipboard', 'success');
        }
    } catch (error) {
        console.error('Error handling pasted text:', error);
        showToast('Failed to paste text', 'error');
    }
}

// Enhanced file upload with clipboard support and text preview
async function uploadFile(file) {
    try {
        // Validate file
        if (!validateFile(file)) {
            showToast(`Invalid file: ${file.name}`, 'error');
            return;
        }

        // Create file entry
        const fileId = generateId();
        const fileData = {
            id: fileId,
            name: file.name,
            size: file.size,
            type: file.type,
            status: 'uploading',
            progress: 0,
            origin: file.origin || 'local',
            url: null,
            textContent: null // Store text content for preview
        };

        // For text files, read content for preview
        if (file.type.startsWith('text/') || isTextFile(file.name)) {
            try {
                const textContent = await file.text();
                fileData.textContent = textContent;
            } catch (error) {
                console.warn('Could not read text content:', error);
            }
        }

        // Add to list
        addFileToList(fileData);

        // Start upload
        const uploadPromise = startFileUpload(file, fileId);
        uploadPromises.set(fileId, uploadPromise);

        try {
            const result = await uploadPromise;
            console.log('✅ uploadPromise resolved:', result);
            if (result.success) {
                console.log('✅ Calling completeFileUpload from uploadFile with URL:', result.fileUrl);
                completeFileUpload({
                    ...fileData,
                    url: result.fileUrl,
                    progress: 100
                });

                // Update inline preview for text files
                if (fileData.textContent && isTextFile(file.name)) {
                    updateInlineTextPreview(fileId, fileData.textContent);
                }

                showToast(`Upload completed: ${file.name}`, 'success');
            }
        } catch (error) {
            showErrorOnFile(fileId, error.message);
            showToast(`Upload failed: ${file.name}`, 'error');
        } finally {
            uploadPromises.delete(fileId);
        }

    } catch (error) {
        console.error('Upload error:', error);
        showToast('Upload error occurred', 'error');
    }
}

// Initialize QR Code elements and setup
function initializeQRCode() {
    // 确保 DOM 元素已加载后再获取
    qrCodeImage = document.getElementById('qrCodeImage');
    qrUrlInput = document.getElementById('qrUrlInput');
    copyQrUrlBtn = document.getElementById('copyQrUrlBtn');
    downloadQrBtn = document.getElementById('downloadQrBtn');
    refreshQrBtn = document.getElementById('refreshQrBtn');

    // 现在设置 QR Code
    setupQRCode();
}

// QR Code Functions
function setupQRCode() {
    const currentUrl = window.location.href;

    // Set URL input
    if (qrUrlInput) {
        qrUrlInput.value = currentUrl;
    }

    // Check if qrcode-generator library is available
    if (typeof qrcode === 'undefined') {
        console.warn('qrcode-generator library not loaded, falling back to Google Charts API');
        showToast('QR Code library not loaded, using fallback method', 'warning');

        // Fallback to Google Charts API
        const qrCodeUrl = `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(currentUrl)}&choe=UTF-8`;
        if (qrCodeImage) {
            qrCodeImage.src = qrCodeUrl;
            qrCodeImage.alt = 'Room QR Code';
        }
        return;
    }

    // Generate QR Code using qrcode-generator library
    if (qrCodeImage) {
        try {
            // 生成 QR 码
            const qr = qrcode(0, 'M');  // 0 = 自动选择版本, M = 纠错等级
            qr.addData(currentUrl);
            qr.make();

            // 生成 base64 图片
            const qrCodeDataUrl = qr.createDataURL(200, 20);  // 200x200像素，20像素模块大小

            qrCodeImage.src = qrCodeDataUrl;
            qrCodeImage.alt = 'Room QR Code';
            showToast('QR Code generated successfully', 'success');
        } catch (error) {
            console.error('QR Code generation failed:', error);
            showToast('Failed to generate QR Code', 'error');

            // Fallback to Google Charts API
            const qrCodeUrl = `https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=${encodeURIComponent(currentUrl)}&choe=UTF-8`;
            if (qrCodeImage) {
                qrCodeImage.src = qrCodeUrl;
                qrCodeImage.alt = 'Room QR Code';
            }
        }
    }
}

function downloadQRCode() {
    if (!qrCodeImage || !qrCodeImage.src) {
        showToast('QR Code not available', 'error');
        return;
    }

    // Create download link
    const link = document.createElement('a');
    link.href = qrCodeImage.src;
    link.download = `room-${roomId}-qr-code.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('QR Code downloading...', 'success');
}

// Utility function to get domain with port
function getCurrentDomain() {
    const protocol = window.location.protocol;
    const host = window.location.host;
    return `${protocol}//${host}`;
}

// Utility function to format bytes
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Utility function to generate unique ID
function generateUniqueId() {
    return Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
}

// Update file element creation to show origin and preview
function createFileElement(fileData) {
    const fileItem = document.createElement('div');
    fileItem.className = `file-item ${fileData.status}`;
    fileItem.dataset.fileId = fileData.id;

    const icon = getFileIcon(fileData.type);
    const size = formatFileSize(fileData.size);
    const originBadge = fileData.origin ? getOriginBadge(fileData.origin) : '';

    fileItem.innerHTML = `
        <div class="file-header">
            <div class="file-icon">${icon}</div>
            <div class="file-name">${fileData.name}${originBadge}</div>
            <div class="file-size">${size}</div>
            <div class="file-status">${getStatusText(fileData)}</div>
        </div>
        <div class="progress-bar">
            <div class="progress-fill" style="width: ${fileData.progress || 0}%"></div>
        </div>
        <div class="file-actions">
            <button class="btn-preview" ${fileData.status === 'completed' ? '' : 'disabled'}>👁️ Preview</button>
            <button class="btn-download" ${fileData.status === 'completed' ? '' : 'disabled'}>📥 Download</button>
            <button class="btn-cancel">❌ Cancel</button>
        </div>
    `;

    // Add event listeners
    const previewBtn = fileItem.querySelector('.btn-preview');
    const downloadBtn = fileItem.querySelector('.btn-download');
    const cancelBtn = fileItem.querySelector('.btn-cancel');

    // 修复按钮点击事件 - 使用箭头函数绑定fileData
    previewBtn.addEventListener('click', () => {
        // 从currentFiles获取最新数据，避免闭包问题
        const latestFileData = currentFiles.get(fileData.id);
        if (latestFileData?.status === 'completed' && latestFileData?.url) {
            openPreview(latestFileData);
        } else {
            showToast('File is still uploading or URL not available', 'warning');
        }
    });

    downloadBtn.addEventListener('click', () => {
        console.log('📥 Download button clicked for:', fileData.name);
        // 从currentFiles获取最新数据，避免闭包问题
        const latestFileData = currentFiles.get(fileData.id);
        console.log('📥 Latest file status:', latestFileData?.status);
        console.log('📥 Latest file URL:', latestFileData?.url);

        if (latestFileData?.status === 'completed' && latestFileData?.url) {
            console.log('📥 Calling downloadFile');
            downloadFile(latestFileData);
        } else {
            console.log('📥 Cannot download - status or URL missing');
            showToast('File is still uploading or URL not available', 'warning');
        }
    });

    cancelBtn.addEventListener('click', () => {
        cancelUpload(fileData.id);
    });

    // 如果是已完成的文件，添加内容预览
    if (fileData.status === 'completed') {
        const contentPreview = createContentPreview(fileData);
        if (contentPreview) {
            fileItem.appendChild(contentPreview);
        }
    }

    return fileItem;
}

// Create content preview for completed files
function createContentPreview(fileData) {
    const type = (fileData.type || '').toLowerCase();

    // Image preview - 直接显示图片
    if (type.startsWith('image/')) {
        const preview = document.createElement('div');
        preview.className = 'content-preview image-preview';
        preview.innerHTML = `
            <div class="preview-thumbnail">
                <img src="${fileData.url}" alt="${fileData.name}" class="preview-image" loading="lazy">
            </div>
        `;
        return preview;
    }

    // Video preview - 直接显示视频预览图
    if (type.startsWith('video/')) {
        const preview = document.createElement('div');
        preview.className = 'content-preview video-preview';
        preview.innerHTML = `
            <div class="preview-thumbnail">
                <video controls class="preview-video" preload="metadata" poster="">
                    <source src="${fileData.url}" type="${type}">
                    Your browser does not support the video tag.
                </video>
            </div>
        `;
        return preview;
    }

    // Text preview - 显示前2行内容
    if (type.startsWith('text/') || isTextFile(fileData.name)) {
        const preview = document.createElement('div');
        preview.className = 'content-preview text-preview';
        preview.innerHTML = `
            <div class="text-actions">
                <button class="btn-copy-text" title="Copy text">📋 Copy</button>
                <button class="btn-expand-text" title="Expand text">⋯ More</button>
            </div>
            <div class="text-content" data-file-id="${fileData.id}"></div>
        `;

        // 添加按钮事件
        const copyBtn = preview.querySelector('.btn-copy-text');
        const expandBtn = preview.querySelector('.btn-expand-text');

        if (copyBtn) {
            copyBtn.onclick = () => copyTextFromFile(fileData);
        }

        if (expandBtn) {
            expandBtn.onclick = () => openTextPreview(fileData);
        }

        // 显示前2行内容
        setTimeout(() => {
            const textContentElement = preview.querySelector('.text-content');
            if (textContentElement) {
                if (fileData.textContent) {
                    updateInlineTextPreview(fileData.id, fileData.textContent, 2);
                } else if (fileData.url) {
                    loadTextContentForPreview(fileData, textContentElement, 2);
                }
            }
        }, 50);

        return preview;
    }

    // Default preview for other files
    const preview = document.createElement('div');
    preview.className = 'content-preview default-preview';
    preview.innerHTML = `
        <div class="preview-default">
            <p>File ready for download</p>
        </div>
    `;
    return preview;
}

// Get origin badge
function getOriginBadge(origin) {
    const badgeMap = {
        'local': ' <span class="badge local">📁 Local</span>',
        'clipboard': ' <span class="badge clipboard">📋 Clipboard</span>',
        'clipboard-text': ' <span class="badge clipboard-text">📝 Text</span>',
        'dragdrop': ' <span class="badge dragdrop">✋ Drag</span>',
        'file-manager': ' <span class="badge file-manager">📂 File</span>',
        'image': ' <span class="badge image">🖼️ Image</span>'
    };

    return badgeMap[origin] || '';
}

// Load text content for preview when not pre-stored
async function loadTextContentForPreview(fileData, element) {
    try {
        const response = await fetch(fileData.url);
        const text = await response.text();

        // 更新文件数据
        fileData.textContent = text;

        // 显示预览
        updateInlineTextPreview(fileData.id, text);
    } catch (error) {
        console.error('Error loading text content for preview:', error);
        element.innerHTML = '<div class="inline-text-content">Error loading content</div>';
    }
}

// Check if file is a text file
function isTextFile(filename) {
    const textExtensions = ['.txt', '.md', '.js', '.css', '.html', '.htm', '.json', '.xml', '.csv', '.log', '.py', '.java', '.c', '.cpp', '.php', '.rb', '.go', '.rust'];
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    return textExtensions.includes(ext);
}

// Open preview modal
function openPreview(fileData) {
    const type = (fileData.type || '').toLowerCase();

    // Image preview
    if (type.startsWith('image/')) {
        openImagePreview(fileData);
    }
    // Video preview
    else if (type.startsWith('video/')) {
        openVideoPreview(fileData);
    }
    // Text preview
    else if (type.startsWith('text/') || isTextFile(fileData.name)) {
        openTextPreview(fileData);
    }
    // Other files - try to open in new tab
    else {
        window.open(fileData.url, '_blank');
    }
}

// Open image preview modal
function openImagePreview(fileData) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content image-modal">
            <span class="modal-close">×</span>
            <div class="modal-header">
                <h3>${fileData.name}</h3>
                <p>${formatFileSize(fileData.size)}</p>
            </div>
            <div class="modal-body">
                <img src="${fileData.url}" alt="${fileData.name}" class="modal-image" loading="lazy">
            </div>
            <div class="modal-footer">
                <button class="btn-primary" onclick="window.open('${fileData.url}', '_blank')">📥 Download</button>
                <button class="btn-secondary" onclick="this.closest('.modal').remove()">Close</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Close modal on click
    modal.querySelector('.modal-close').addEventListener('click', () => {
        modal.remove();
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// Open video preview modal
function openVideoPreview(fileData) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content video-modal">
            <span class="modal-close">×</span>
            <div class="modal-header">
                <h3>${fileData.name}</h3>
                <p>${formatFileSize(fileData.size)}</p>
            </div>
            <div class="modal-body">
                <video controls class="modal-video" preload="metadata">
                    <source src="${fileData.url}" type="${fileData.type}">
                    Your browser does not support the video tag.
                </video>
            </div>
            <div class="modal-footer">
                <button class="btn-primary" onclick="window.open('${fileData.url}', '_blank')">📥 Download</button>
                <button class="btn-secondary" onclick="this.closest('.modal').remove()">Close</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Close modal on click
    modal.querySelector('.modal-close').addEventListener('click', () => {
        modal.remove();
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// Open text preview modal
function openTextPreview(fileData) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content text-modal">
            <span class="modal-close">×</span>
            <div class="modal-header">
                <h3>${fileData.name}</h3>
                <p>${formatFileSize(fileData.size)}</p>
            </div>
            <div class="modal-body">
                <div class="text-actions">
                    <button class="btn-copy-text-modal" title="Copy all text">📋 Copy All</button>
                    <button class="btn-download-text" title="Download as file" onclick="window.open('${fileData.url}', '_blank')">📥 Download</button>
                </div>
                <pre class="modal-text" id="modal-text-${fileData.id}">Loading...</pre>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" onclick="this.closest('.modal').remove()">Close</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Load text content
    loadTextContent(fileData, `modal-text-${fileData.id}`);

    // Copy button
    modal.querySelector('.btn-copy-text-modal').addEventListener('click', () => {
        copyTextFromFile(fileData);
    });

    // Close modal on click
    modal.querySelector('.modal-close').addEventListener('click', () => {
        modal.remove();
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// Load text content for preview
async function loadTextContent(fileData, elementId) {
    try {
        const response = await fetch(fileData.url);
        const text = await response.text();

        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = text;
        }

        // Also update inline preview if exists
        updateInlineTextPreview(fileData.id, text);
    } catch (error) {
        console.error('Error loading text content:', error);
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = 'Error loading file content';
        }
    }
}

// Update inline text preview
function updateInlineTextPreview(fileId, text, maxLines = 2) {
    const previewElement = document.querySelector(`.text-content[data-file-id="${fileId}"]`);
    if (!previewElement) return;

    const lines = text.split('\n');
    const isLongText = lines.length > maxLines;

    let displayText = lines.slice(0, maxLines).join('\n');
    if (isLongText) {
        displayText += `\n⋯⋯ (showing first ${maxLines} lines, click "More" to view all)`;
    }

    previewElement.innerHTML = `
        <div class="inline-text-content">${escapeHtml(displayText)}</div>
        ${isLongText ? `<div class="text-expand-btn">📖 View All</div>` : ''}
    `;

    // Add copy button functionality
    const copyBtn = previewElement.closest('.file-item')?.querySelector('.btn-copy-text');
    if (copyBtn) {
        // 使用fileId获取fileData
        copyBtn.onclick = () => {
            const fileData = currentFiles.get(fileId);
            if (fileData) {
                copyTextFromFile(fileData);
            }
        };
    }

    // Add expand button functionality
    const expandBtn = previewElement.querySelector('.text-expand-btn');
    if (expandBtn) {
        expandBtn.onclick = () => openTextPreview({ ...currentFiles.get(fileId), url: currentFiles.get(fileId)?.url });
    }
}

// Copy text from file
async function copyTextFromFile(fileData) {
    try {
        const response = await fetch(fileData.url);
        const text = await response.text();

        await copyToClipboard(text);
        showToast('Text copied to clipboard', 'success');
    } catch (error) {
        console.error('Error copying text:', error);
        showToast('Failed to copy text', 'error');
    }
}

// Enhanced clipboard copy function with fallback
async function copyToClipboard(text) {
    // Method 1: Modern Clipboard API (preferred)
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch (err) {
            console.warn('Clipboard API failed:', err);
        }
    }

    // Method 2: Fallback using execCommand (for older browsers)
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);

        if (!successful) {
            throw new Error('execCommand failed');
        }
    } catch (err) {
        console.error('Copy failed:', err);
        throw err;
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    return text
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, "'");
}

// Enhanced file upload to store text content for preview