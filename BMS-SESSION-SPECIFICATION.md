# BMS Session Specification

## Overview
The BMS (Bangkok Medical Software) Session system provides secure authentication and database access for HOSxP hospital management systems. This specification documents how the system uses `bms-session-id` to establish user sessions, authenticate API requests, and execute SQL queries against hospital databases.

## Architecture Flow

### 1. Session ID Acquisition
The system supports three methods to obtain a BMS session ID:

1. **URL Parameter**: `?bms-session-id=SESSION_ID`
2. **Cookie Storage**: Automatically stored for 7 days after successful authentication
3. **Manual Input**: User enters session ID through the UI

### 2. Session Retrieval Flow

```
User → URL/Cookie/Input → SessionValidator → retrieveBmsSession() → HOSxP API
                                                     ↓
                                        https://hosxp.net/phapi/PasteJSON
                                                     ↓
                                           Session Data Response
```

## Core Components

### Service Layer (`src/services/bmsSession.ts`)

#### Key Functions:

1. **`retrieveBmsSession(sessionId: string)`**
   - Calls HOSxP PasteJSON API with session ID
   - Returns session data including user info and connection config
   - Handles authentication and error states

2. **`executeSqlViaApi(sql, config)`**
   - Executes SQL queries against hospital database
   - Uses connection config from session data
   - Supports Bearer token authentication

3. **`extractConnectionConfig(sessionData)`**
   - Extracts API URL and authentication key from session response
   - Falls back through multiple config sources (key_value → user_info)

#### Data Types:

```typescript
interface BmsSessionResponse {
  MessageCode: number;        // 200 = success, 500 = expired
  Message?: string;
  result?: {
    user_info?: {
      name?: string;
      location?: string;
      doctor_code?: string;
      bms_url?: string;
      bms_session_code?: string;
      "hosxp.api_url"?: string;
      "hosxp.api_auth_key"?: string;
    };
    key_value?: {
      "hosxp.api_url"?: string;
      "hosxp.api_auth_key"?: string;
    };
  };
}
```

### React Hooks (`src/hooks/useBmsSession.ts`)

#### `useBmsSession()` Hook
Primary React hook for session management:

- **State Management**: Tracks session ID, data, connection config, user info
- **Connection Methods**:
  - `connectSession(sessionId)` - Establishes new session
  - `disconnectSession()` - Clears current session
  - `refreshSession()` - Refreshes existing session
- **Query Execution**: `executeQuery(sql)` - Runs SQL via authenticated API

#### `useQuery()` Hook
Manages SQL query lifecycle:

- Tracks query data, loading state, errors
- Supports auto-execution on mount
- Provides `execute()` and `reset()` methods

### Session Storage (`src/utils/sessionStorage.ts`)

#### Cookie Management:
- **Storage**: 7-day expiry, secure flag for HTTPS
- **Functions**:
  - `setSessionCookie(sessionId)` - Stores session
  - `getSessionCookie()` - Retrieves stored session
  - `removeSessionCookie()` - Clears session

#### URL Handling:
- `getSessionFromUrl()` - Extracts from URL parameter
- `removeSessionFromUrl()` - Cleans URL after extraction
- `handleUrlSession()` - Combined flow: extract → store → clean

### Context Provider (`src/contexts/BmsSessionContext.tsx`)

Provides global session state via React Context:
- Wraps app with `BmsSessionProvider`
- Access via `useBmsSessionContext()` hook
- Shares session state across all components

## Complete Data Flow

### 1. Session Initialization

```
1. User visits: https://app.example.com/?bms-session-id=ABC123
2. SessionValidator component mounts
3. handleUrlSession() is called:
   - Extracts "ABC123" from URL
   - Stores in cookie (7-day expiry)
   - Removes parameter from URL (clean URL)
4. connectSession("ABC123") is triggered
```

### 2. Session Validation

```
1. retrieveBmsSession("ABC123") called
2. GET request to: https://hosxp.net/phapi/PasteJSON?Action=GET&code=ABC123
3. Response parsed:
   - MessageCode 200: Success → Extract config
   - MessageCode 500: Session expired
   - Other: Error handling
4. extractConnectionConfig() processes response:
   - Primary: key_value["hosxp.api_url"]
   - Fallback: user_info["hosxp.api_url"]
   - Fallback: user_info.bms_url
```

### 3. API Configuration Extraction

The system uses a hierarchical fallback for configuration:

```javascript
// Priority order for API URL:
1. result.key_value["hosxp.api_url"]
2. result.user_info["hosxp.api_url"]
3. result.user_info.bms_url

// Priority order for Auth Key:
1. result.key_value["hosxp.api_auth_key"]
2. result.user_info["hosxp.api_auth_key"]
3. result.user_info.bms_session_code
```

### 4. SQL Query Execution

```
1. Component calls: session.executeQuery(sql)
2. executeSqlViaApi() builds request:
   - URL: {apiUrl}/api/sql?sql={encodedSQL}&app=BMS.Dashboard.React
   - Headers: Authorization: Bearer {apiAuthKey}
3. SQL is minified before transport (comments removed, whitespace compressed)
4. Response handled:
   - 200: Parse JSON data array
   - 401: Unauthorized (invalid key)
   - 502: Bad Gateway (tunnel issue)
   - Other: Error handling
5. Following is sample data return from api /api/sql
{"result":{},"MessageCode":200,"Message":"OK","RequestTime":"2025-09-19T21:02:32.698Z","data":[{"dashboard_url_settings_id":2,"dashboard_url":"https://finance-dashboard.bmscloud.in.th/","dashboard_description":"BMS Finance Dashboard","dashboard_vendor":"BMS","dashboard_auth_key":null,"update_datetime":null}]}
```

## Component Integration

### SessionValidator Component
Entry point for session management:

```jsx
<BmsSessionProvider>
  <SessionValidator onSessionReady={handleReady}>
    {/* Protected content */}
  </SessionValidator>
</BmsSessionProvider>
```

- Shows login UI if no session
- Validates existing sessions
- Manages session lifecycle

### Using Session in Components

```jsx
function MyComponent() {
  const session = useBmsSessionContext();

  // Check connection status
  if (!session.isConnected) {
    return <div>Not connected</div>;
  }

  // Execute SQL query
  const handleQuery = async () => {
    const result = await session.executeQuery(
      "SELECT * FROM patient LIMIT 10"
    );

    if (result.ok) {
      console.log("Data:", result.data);
    }
  };
}
```

## Security Considerations

### Authentication
- Session IDs are temporary tokens from HOSxP system
- Bearer token authentication for API calls
- Sessions expire (MessageCode 500)

### Data Protection
- HTTPS enforced for production
- Cookies use secure flag when on HTTPS
- Session IDs removed from URL after processing

### SQL Injection Prevention
- SQL queries are URL-encoded before transmission
- Backend HOSxP API should validate and sanitize

## Error Handling

### Session Errors
- **Expired Session**: MessageCode 500, prompts re-authentication
- **Invalid Session**: 401 Unauthorized, invalid/missing API key
- **Network Issues**: 502 Bad Gateway, timeout handling (30s default)

### Query Errors
- SQL syntax errors returned in response
- Connection failures trigger retry logic
- Timeout after 30 seconds by default

## Best Practices

### Session Management
1. Always check `isConnected` before queries
2. Handle session expiry gracefully
3. Clear sessions on logout

### Query Optimization
1. Minify SQL before transport
2. Use parallel queries when possible
3. Implement proper error handling

### Component Design
1. Use context provider at app root
2. Leverage hooks for state management
3. Implement loading states

## Example Implementation

### Full Component with Session

```jsx
import { useBmsSessionContext, useQuery } from '../hooks/useBmsSession';

function HospitalStats() {
  const session = useBmsSessionContext();
  const query = useQuery(
    "SELECT COUNT(*) as total FROM patient",
    session,
    true // auto-execute
  );

  if (!session.isConnected) {
    return <div>Please connect session</div>;
  }

  if (query.isLoading) {
    return <div>Loading...</div>;
  }

  if (query.error) {
    return <div>Error: {query.error}</div>;
  }

  return (
    <div>
      <h2>Patient Count: {query.data?.[0]?.total || 0}</h2>
      <p>User: {session.userInfo?.name}</p>
      <p>Hospital: {session.userInfo?.location}</p>
    </div>
  );
}
```

### Manual Session Connection

```jsx
function LoginForm() {
  const [sessionId, setSessionId] = useState('');
  const session = useBmsSessionContext();

  const handleConnect = async () => {
    const success = await session.connectSession(sessionId);
    if (success) {
      // Store in cookie for persistence
      setSessionCookie(sessionId);
    }
  };

  return (
    <div>
      <input
        value={sessionId}
        onChange={(e) => setSessionId(e.target.value)}
        placeholder="Enter BMS Session ID"
      />
      <button onClick={handleConnect}>
        Connect
      </button>
    </div>
  );
}
```

## Testing

### Connection Test Query
```sql
SELECT VERSION()
```

### Sample Statistics Query
```sql
SELECT
  COUNT(*) as patient_count,
  SUM(income) as total_income
FROM vn_stat
WHERE vstdate BETWEEN '2024-01-01' AND '2024-12-31'
```

## Troubleshooting

### Common Issues

1. **Session Not Found**
   - Check URL parameter format: `?bms-session-id=VALUE`
   - Verify cookie is set correctly
   - Ensure session hasn't expired

2. **API Connection Failed**
   - Verify network connectivity
   - Check CORS settings if applicable
   - Confirm API URL is accessible

3. **SQL Execution Errors**
   - Validate SQL syntax
   - Check database permissions
   - Verify table/column names

## Version History

- v1.0.0: Initial implementation
- Support for URL parameter, cookie storage
- HOSxP API integration
- React hooks and context provider