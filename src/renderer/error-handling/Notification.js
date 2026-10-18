/* 
  SOUL LAUNCHER - NOTIFICATION COMPONENT
  Handles Error, Warning, and Success states based on network and system events.
*/

class NotificationSystem {
    constructor() {
        this.container = null;
        this.init();
    }

    init() {
        // Create container if it doesn't exist
        if (!document.getElementById('notification-container')) {
            this.container = document.createElement('div');
            this.container.id = 'notification-container';
            document.body.appendChild(this.container);
        } else {
            this.container = document.getElementById('notification-container');
        }

        // Listen for network changes
        window.addEventListener('online', () => {
            this.show('info', 'Network Connected', 'Establishing stable connection...');
            setTimeout(() => {
                this.show('success', 'Connected Successfully', 'All systems online.');
            }, 2000);
        });
        window.addEventListener('offline', () => this.show('error', 'No Network', 'Please check your internet connection.'));

        // Check initial state
        if (!navigator.onLine) {
            this.show('error', 'No Network', 'Please check your internet connection.');
        } else {
            // Initial success state if already online
            this.show('success', 'Connected Successfully', 'Launcher is ready.');
        }
    }

    show(type, title, message) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        
        const iconClass = {
            'error': 'fa-circle-xmark',
            'warning': 'fa-triangle-exclamation',
            'success': 'fa-circle-check',
            'info': 'fa-circle-info'
        }[type];

        notification.innerHTML = `
            <div class="notification-icon">
                <i class="fa-solid ${iconClass}"></i>
            </div>
            <div class="notification-content">
                <div class="notification-title">${title}</div>
                <div class="notification-message">${message}</div>
            </div>
            <div class="notification-actions">
                <button class="notification-btn copy-btn" title="Copy Error">
                    <i class="fa-solid fa-copy"></i>
                </button>
                <button class="notification-btn close-btn" title="Close">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        `;

        this.container.appendChild(notification);

        // Copy functionality
        notification.querySelector('.copy-btn').onclick = () => {
            navigator.clipboard.writeText(`${title}: ${message}`);
            // Optional: change icon briefly
            const icon = notification.querySelector('.copy-btn i');
            icon.className = 'fa-solid fa-check';
            setTimeout(() => icon.className = 'fa-solid fa-copy', 2000);
        };

        // Close functionality
        notification.querySelector('.close-btn').onclick = () => {
            notification.classList.add('hide');
            setTimeout(() => notification.remove(), 400);
        };

        // Auto remove success after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.classList.add('hide');
                    setTimeout(() => notification.remove(), 400);
                }
            }, 5000);
        }
    }
}

// Initialize the system
const notifications = new NotificationSystem();
window.notifications = notifications;
