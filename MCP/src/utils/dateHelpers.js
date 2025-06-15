/**
 * Date and timestamp helper utilities
 * Provides safe timestamp formatting to prevent "Invalid time value" errors
 */

/**
 * Safely format a timestamp with error handling
 * @param {any} timestamp - The timestamp to format (can be number, string, Date, or invalid)
 * @param {string} format - The format type: 'iso', 'date', 'time', 'datetime'
 * @returns {string} Formatted timestamp or fallback message
 */
function formatTimestamp(timestamp, format = 'iso') {
  // Handle null, undefined, or empty values
  if (!timestamp && timestamp !== 0) {
    return 'Unknown';
  }

  // Try to create a valid date
  let date;
  try {
    date = new Date(timestamp);
  } catch (error) {
    return 'Invalid Date';
  }

  // Check if the date is valid - this is critical!
  if (isNaN(date.getTime()) || date.getTime() === null || date.getTime() === undefined) {
    return 'Invalid Date';
  }

  // Additional check for very specific edge cases
  try {
    const timeValue = date.getTime();
    if (typeof timeValue !== 'number' || !isFinite(timeValue)) {
      return 'Invalid Date';
    }
  } catch (e) {
    return 'Invalid Date';
  }

  // Additional safety check for extreme dates
  const time = date.getTime();
  if (time < -8640000000000000 || time > 8640000000000000) {
    return 'Invalid Date';
  }

  // Format according to the requested type with extra safety
  try {
    switch (format) {
      case 'iso':
        // Extra safety for toISOString which can throw "Invalid time value"
        try {
          return date.toISOString();
        } catch (e) {
          return 'Invalid Date';
        }
      case 'date':
        try {
          return date.toLocaleDateString();
        } catch (e) {
          return 'Invalid Date';
        }
      case 'time':
        try {
          return date.toLocaleTimeString();
        } catch (e) {
          return 'Invalid Date';
        }
      case 'datetime':
        try {
          return date.toLocaleString();
        } catch (e) {
          return 'Invalid Date';
        }
      case 'relative':
        return formatRelativeTime(date);
      default:
        try {
          return date.toString();
        } catch (e) {
          return 'Invalid Date';
        }
    }
  } catch (error) {
    return 'Format Error';
  }
}

/**
 * Format a relative time string (e.g., "2 hours ago")
 * @param {Date} date - The date to format
 * @returns {string} Relative time string
 */
function formatRelativeTime(date) {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffDays > 7) {
    return date.toLocaleDateString();
  } else if (diffDays > 0) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  } else {
    return 'Just now';
  }
}

/**
 * Safely extract and validate timestamp from response data
 * @param {any} data - The data object that might contain timestamp fields
 * @param {string} field - The field name to extract
 * @returns {number|null} Valid timestamp or null
 */
function safeExtractTimestamp(data, field) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const timestamp = data[field];
  
  // Handle various timestamp formats
  if (typeof timestamp === 'number' && !isNaN(timestamp)) {
    return timestamp;
  }
  
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    return isNaN(parsed) ? null : parsed;
  }
  
  return null;
}

/**
 * Calculate duration between two timestamps
 * @param {any} startTime - Start timestamp
 * @param {any} endTime - End timestamp
 * @returns {string} Duration string or fallback
 */
function formatDuration(startTime, endTime) {
  const start = safeExtractTimestamp({ time: startTime }, 'time');
  const end = safeExtractTimestamp({ time: endTime }, 'time');
  
  if (!start || !end) {
    return 'Unknown duration';
  }
  
  const diffMs = Math.abs(end - start);
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (diffDays > 0) {
    return `${diffDays}d ${diffHours}h`;
  } else if (diffHours > 0) {
    return `${diffHours}h ${diffMinutes}m`;
  } else {
    return `${diffMinutes}m`;
  }
}

// Export all functions using ES6 syntax
export {
  formatTimestamp,
  formatRelativeTime,
  safeExtractTimestamp,
  formatDuration
};
