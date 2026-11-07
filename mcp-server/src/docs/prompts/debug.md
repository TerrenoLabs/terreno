# Debug Assistance

Help debug an issue in a Terreno application.

## Issue Description
{{description}}

## Debugging Checklist

### Backend Issues
1. **Check logs**: Look at `logger.info/warn/error` output
2. **Verify MongoDB connection**: Check `MONGO_URI` environment variable
3. **Check model validation**: Mongoose schema validation errors
4. **API errors**: Look for `APIError` throws with status codes
5. **Authentication**: Verify JWT token and middleware

### Frontend Issues
1. **Check console**: Look for errors in browser/React Native console
2. **Network requests**: Verify API calls in Network tab
3. **Local data state**: Inspect synced collections, the outbox, and conflicts with the
   `get_syncdb_state` local MCP tool (or `terreno state`); the client needs `debug: true`
4. **SDK regeneration**: Run `bun run api-sdk` (request hooks in `store/apiSdk.ts`) after backend
   changes
5. **Component props**: Verify required props are passed

### Common Issues

#### "Cannot find module" errors
- Run `bun install` in the affected package
- Check import paths are correct
- Verify package is in dependencies

#### API 401 Unauthorized
- Check if user is logged in
- Verify token is being sent in headers
- Check token expiration

#### API 404 Not Found
- Verify route is registered in server.ts
- Check route path matches request
- Regenerate SDK if endpoint changed

#### "Network request failed"
- Check backend is running
- Verify `baseUrl` from `@terreno/syncdb/config` (`EXPO_PUBLIC_API_URL`, `extra.BASE_URL`)
- Check CORS settings

#### Form validation errors
- Check required fields are filled
- Verify field types match schema
- Look for custom validation logic

### Debugging Tools
- **Backend**: Use `logger.debug()` for detailed logging
- **Frontend**: Use React DevTools, `get_syncdb_state` / `syncdb_snapshot`, and `read_logs`
- **API**: Use Postman or curl to test endpoints directly
- **Database**: Use MongoDB Compass to inspect data

### Getting More Information
1. Add `console.log` statements (remove before committing)
2. Check error stack traces
3. Review recent code changes
4. Test in isolation
