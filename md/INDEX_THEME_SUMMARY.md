# 🎨 首页主题切换功能 - 已添加

## ✅ 完成的修改

### 1. HTML 修改 (`public/index.html`)

在首页头部添加了主题切换按钮：

```html
<header class="header">
    <h1>🚀 Realtime File Transfer</h1>
    <p class="subtitle">Create a room and share files in real-time with anyone</p>
    <div class="theme-toggle">
        <button id="themeToggle" class="btn-secondary" title="Toggle Dark Mode">
            <span id="themeIcon">🌙</span>
            <span id="themeText">Dark</span>
        </button>
    </div>
</header>
```

**按钮位置**：在首页头部，标题下方，右侧对齐

### 2. JavaScript 修改 (`public/js/index.js`)

添加了完整的主题切换功能：

#### DOM 元素引用
```javascript
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
const themeText = document.getElementById('themeText');
```

#### 主题切换函数
```javascript
function initTheme() {
    // 检查本地存储的主题偏好
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme === 'dark' || (savedTheme === null && prefersDark)) {
        setTheme('dark', false);
    } else {
        setTheme('light', false);
    }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme, true);
}

function setTheme(theme, savePreference = true) {
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.style.colorScheme = 'dark';
        if (themeIcon) themeIcon.textContent = '☀️';
        if (themeText) themeText.textContent = 'Light';
        if (themeToggle) themeToggle.title = 'Switch to Light Mode';
    } else {
        document.documentElement.setAttribute('data-theme', 'light');
        document.documentElement.style.colorScheme = 'light';
        if (themeIcon) themeIcon.textContent = '🌙';
        if (themeText) themeText.textContent = 'Dark';
        if (themeToggle) themeToggle.title = 'Switch to Dark Mode';
    }

    // 保存到本地存储
    if (savePreference) {
        localStorage.setItem('theme', theme);
        showToast(`Switched to ${theme === 'dark' ? 'Dark' : 'Light'} mode`, 'info');
    }
}
```

#### 初始化和事件监听
```javascript
// 初始化主题
initTheme();

// 添加事件监听
themeToggle.addEventListener('click', toggleTheme);

// 监听系统主题变化
if (window.matchMedia) {
    const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    darkModeQuery.addEventListener('change', (e) => {
        // 如果用户已经手动选择了主题，则不自动跟随系统
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === null) {
            // 用户未手动选择，跟随系统
            setTheme(e.matches ? 'dark' : 'light', false);
        }
    });
}
```

## 🎯 功能特性

### 1. 智能初始化
- 首次访问时根据系统偏好自动设置主题
- 如果用户之前选择过主题，会记住用户的选择

### 2. 手动切换
- 点击按钮即可在白天/黑夜模式之间切换
- 按钮图标和文字会相应更新（🌙/☀️，Dark/Light）

### 3. 本地存储
- 用户的选择会保存到 `localStorage.theme`
- 下次访问时会自动应用之前的选择

### 4. 系统跟随
- 如果用户没有手动选择过主题，会自动跟随系统主题变化
- 一旦用户手动选择，就不再跟随系统

### 5. 与其他页面一致
- 与房间页面使用相同的主题切换逻辑
- data-theme 属性统一管理
- CSS 样式完全一致

## 🧪 测试方法

### 1. 访问首页
```bash
# 启动服务器
node server.js

# 访问首页
http://localhost:3000/
```

### 2. 测试功能
- ✅ 查看主题切换按钮是否在头部右侧
- ✅ 点击按钮切换主题
- ✅ 观察页面背景、文字、按钮颜色是否变化
- ✅ 检查按钮图标和文字是否更新
- ✅ 刷新页面，查看主题是否保持
- ✅ 在房间页面和首页之间切换，查看主题是否同步

## 📊 样式对比

### 亮色模式（Light）
- 背景：浅灰色 (#F5F5F7)
- 卡片：白色 (#FFFFFF)
- 文字：深灰色 (#1D1D1F)
- 边框：中灰色 (rgba(60, 60, 67, 0.28))

### 暗色模式（Dark）
- 背景：黑色 (#000000)
- 卡片：黑色 (#000000)
- 文字：白色 (#FFFFFF)
- 边框：浅灰色 (rgba(235, 235, 245, 0.12))

## 🎉 总结

首页现在也支持主题切换功能了！与房间页面完全一致的体验：

- ✅ 按钮位置合适（头部右侧）
- ✅ 功能完整（切换、保存、跟随系统）
- ✅ 样式统一（使用相同的CSS变量和data-theme）
- ✅ 用户体验一致（所有页面主题同步）

用户现在可以在首页和房间页面之间无缝切换，主题设置会自动同步！