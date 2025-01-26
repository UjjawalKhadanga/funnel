import { RL_CONFIG_STORE_KEY } from '../../config.js'

enum ReturnCodes {
    NO_CONFIG = -1,
    INVALID_CONFIG = -2,
    RATE_LIMIT_EXCEEDED = -3,
    SUCCESS = 1,
};


const rateLimitScript = `
local key_name = KEYS[1]

-- Get current timestamp in seconds from Redis
local time_data = redis.call('TIME')
local curr_timestamp = tonumber(time_data[1])

-- Generate a unique identifier for this request
local unique_id = math.random(100000, 999999)
local unique_timestamp = curr_timestamp .. ':' .. unique_id  -- Combine timestamp with unique ID

-- Fetch configuration for the specific key
local config_key = "${RL_CONFIG_STORE_KEY}"
local config_str = redis.call('JSON.GET', config_key, '$.' .. key_name)

-- Check if configuration exists and is valid
if not config_str or config_str == '' then
    return ${ReturnCodes.NO_CONFIG}  -- No configuration found for this key, block the request
end

-- Parse the JSON configuration
local config = cjson.decode(config_str)[1]
if not config then
    return ${ReturnCodes.INVALID_CONFIG}  -- Invalid configuration, block the request
end

local duration = tonumber(config.duration)
local points = tonumber(config.points)

if not duration or not points then
    return ${ReturnCodes.INVALID_CONFIG}  -- Invalid configuration, block the request
end

-- Check if key exists, if not, create it
if redis.call('EXISTS', key_name) == 0 then
    redis.call('ZADD', key_name, curr_timestamp, unique_timestamp)
    return ${ReturnCodes.SUCCESS}
end

-- Remove timestamps outside the duration window
local cutoff_time = curr_timestamp - duration
redis.call('ZREMRANGEBYSCORE', key_name, 0, cutoff_time)

-- Check if request should be rate limited
local count = redis.call('ZCARD', key_name)

if count >= points then
    return ${ReturnCodes.RATE_LIMIT_EXCEEDED}  -- Rate limit exceeded, block the request
end

-- Add current timestamp with unique identifier and allow the request
redis.call('ZADD', key_name, curr_timestamp, unique_timestamp)
return ${ReturnCodes.SUCCESS}
`;

export { rateLimitScript, ReturnCodes };
