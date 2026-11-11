import { RL_CONFIG_STORE_KEY } from '../../config.js'

enum ReturnCodes {
    NO_CONFIG = -1,
    INVALID_CONFIG = -2,
    RATE_LIMIT_EXCEEDED = -3,
    SUCCESS = 1,
};


const rateLimitScript = `
local key_name = KEYS[1]

-- Millisecond timestamp from Redis TIME (seconds, microseconds)
local time_data = redis.call('TIME')
local curr_ms = tonumber(time_data[1]) * 1000 + math.floor(tonumber(time_data[2]) / 1000)
local unique_id = time_data[1] .. ':' .. time_data[2] .. ':' .. math.random(100000, 999999)

-- Fetch configuration for the specific key
local config_key = "${RL_CONFIG_STORE_KEY}"
local config_str = redis.call('JSON.GET', config_key, '$.' .. key_name)

-- {code, retryAfterMs}. retryAfterMs is how long until the oldest hit leaves the window.
if not config_str or config_str == '' or config_str == '[]' or config_str == 'null' then
    return {${ReturnCodes.NO_CONFIG}, 0}
end

local config = cjson.decode(config_str)[1]
if not config then
    return {${ReturnCodes.NO_CONFIG}, 0}
end

local duration = tonumber(config.duration)
local points = tonumber(config.points)

if not duration or duration <= 0 or duration == math.huge or
   not points or points < 1 or points > 9007199254740991 or points ~= math.floor(points) then
    return {${ReturnCodes.INVALID_CONFIG}, 0}
end

local duration_ms = duration * 1000

if redis.call('EXISTS', key_name) == 0 then
    redis.call('ZADD', key_name, curr_ms, unique_id)
    return {${ReturnCodes.SUCCESS}, 0}
end

local cutoff_time = curr_ms - duration_ms
redis.call('ZREMRANGEBYSCORE', key_name, 0, cutoff_time)

local count = redis.call('ZCARD', key_name)

if count >= points then
    local oldest = redis.call('ZRANGE', key_name, 0, 0, 'WITHSCORES')
    local oldest_ms = tonumber(oldest[2])
    local retry_after_ms = math.ceil(oldest_ms + duration_ms - curr_ms)
    if retry_after_ms < 1 then
        retry_after_ms = 1
    end
    return {${ReturnCodes.RATE_LIMIT_EXCEEDED}, retry_after_ms}
end

redis.call('ZADD', key_name, curr_ms, unique_id)
return {${ReturnCodes.SUCCESS}, 0}
`;

export { rateLimitScript, ReturnCodes };
