const axios = require('axios')
const dsteem = require('dsteem')
const { BlockchainMode } = require('dsteem')
require('dotenv').config()

let BOTNAME = process.env.BOTNAME;
var STEEMIT_100_PERCENT = 10000;
var STEEMIT_VOTE_REGENERATION_SECONDS = (5 * 60 * 60 * 24);
var HOURS = 60 * 60;

let steemVars = (() => {
    let steem_price, sbd_price;
    var steemPrice;
    var rewardBalance;
    var recentClaims;
    var currentUserAccount;
    var votePowerReserveRate;
    var totalVestingFund;
    var totalVestingShares;
    var steem_per_mvests;
})();

async function updateSteemVariables() {
    await client.database.call('get_reward_fund', ['post']).then(function (t) {
        rewardBalance = parseFloat(t.reward_balance.replace(" STEEM", ""));
        recentClaims = t.recent_claims;
    }, function (e) {
        log('Error loading reward fund: ' + e);
    });

    await client.database.getCurrentMedianHistoryPrice().then(function (t) {
        steemPrice = parseFloat(t.base) / parseFloat(t.quote);
    }, function (e) {
        log('Error loading steem price: ' + e);
    });

    await client.database.getDynamicGlobalProperties().then(function (t) {
        votePowerReserveRate = t.vote_power_reserve_rate;
        totalVestingFund = parseFloat(t.total_vesting_fund_steem.replace(" STEEM", ""));
        totalVestingShares = parseFloat(t.total_vesting_shares.replace(" VESTS", ""));
        steem_per_mvests = ((totalVestingFund / totalVestingShares) * 1000000);
    }, function (e) {
        log('Error loading global properties: ' + e);
    });

}
exports.updateSteemVariables = updateSteemVariables;

function sleep(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}

Number.prototype.formatMoney = function (c, d, t) {
    var n = this,
        c = isNaN(c = Math.abs(c)) ? 2 : c,
        d = d == undefined ? "." : d,
        t = t == undefined ? "," : t,
        s = n < 0 ? "-" : "",
        i = String(parseInt(n = Math.abs(Number(n) || 0).toFixed(c))),
        j = (j = i.length) > 3 ? j % 3 : 0;
    return s + (j ? i.substr(0, j) + t : "") + i.substr(j).replace(/(\d{3})(?=\d)/g, "$1" + t) + (c ? d + Math.abs(n - i).toFixed(c).slice(2) : "");
};

function getUsdValue(bid) {
    if (bid.currency)
        return parseFloat(bid.amount) * ((bid.currency == 'SBD') ? sbd_price : steem_price);
    else
        return parseFloat(bid.amount) * ((getCurrency(bid.amount) == 'SBD') ? sbd_price : steem_price);
}

async function getBotROI() {
    var AUTHOR_REWARDS = 0.75;
    let roi;

    await axios.get(`https://steembottracker.net/bid_bots/${BOTNAME}`)
        .then(async z => {
            let data = z.data;
            if (data && data.current_round.length > 0) {
                data.current_round.round_total = data.current_round.reduce(function (t, b) { return t + getUsdValue(b); }, 0);
                await client.database.getAccounts([BOTNAME]).then(function (result) {
                    let account = result[0];
                    roi = (((getVoteValue(100, account) * AUTHOR_REWARDS / data.current_round.round_total) - 1) * 100).formatMoney()
                })

            } else {
                roi = 'There are no bid yet.. Perfect time to be the first to grab some profits!'
            }
        })
    return roi;
}

exports.getBotROI = getBotROI;

exports.vestsToSP = function (vests) { return vests / 1000000 * steem_per_mvests }

exports.getVotingPower = function (account) {
    var voting_power = account.voting_power;
    var last_vote_time = new Date((account.last_vote_time) + 'Z');
    var elapsed_seconds = (new Date() - last_vote_time) / 1000;
    var regenerated_power = Math.round((STEEMIT_100_PERCENT * elapsed_seconds) / STEEMIT_VOTE_REGENERATION_SECONDS);
    var current_power = Math.min(voting_power + regenerated_power, STEEMIT_100_PERCENT);
    return current_power;
}

function getVoteRShares(voteWeight, account, power) {
    if (!account) {
        return;
    }

    if (rewardBalance && recentClaims && steemPrice && votePowerReserveRate) {

        var effective_vesting_shares = Math.round(getVestingShares(account) * 1000000);
        var voting_power = account.voting_power;
        var weight = voteWeight * 100;
        var last_vote_time = new Date((account.last_vote_time) + 'Z');


        var elapsed_seconds = (new Date() - last_vote_time) / 1000;
        var regenerated_power = Math.round((STEEMIT_100_PERCENT * elapsed_seconds) / STEEMIT_VOTE_REGENERATION_SECONDS);
        var current_power = power || Math.min(voting_power + regenerated_power, STEEMIT_100_PERCENT);
        var max_vote_denom = votePowerReserveRate * STEEMIT_VOTE_REGENERATION_SECONDS / (60 * 60 * 24);
        var used_power = Math.round((current_power * weight) / STEEMIT_100_PERCENT);
        used_power = Math.round((used_power + max_vote_denom - 1) / max_vote_denom);

        var rshares = Math.round((effective_vesting_shares * used_power) / (STEEMIT_100_PERCENT))

        return rshares;

    }
}

function getVoteValue(voteWeight, account, power) {
    if (!account) {
        return;
    }
    if (rewardBalance && recentClaims && steemPrice && votePowerReserveRate) {
        var voteValue = getVoteRShares(voteWeight, account, power)
            * rewardBalance / recentClaims
            * steemPrice;

        return voteValue;

    }
}
exports.getVoteValue = getVoteValue;

exports.timeTilFullPower = function timeTilFullPower(cur_power) {
    return (STEEMIT_100_PERCENT - cur_power) * STEEMIT_VOTE_REGENERATION_SECONDS / STEEMIT_100_PERCENT;
}

exports.toTimer = function (ts) {
    var h = Math.floor(ts / HOURS);
    var m = Math.floor((ts % HOURS) / 60);

    return padLeft(h, 2) + ' H:' + padLeft(m, 2) + ' MIN'

    function padLeft(v, d) {
        var l = (v + '').length;
        if (l >= d) return v + '';
        for (var i = l; i < d; i++)
            v = '0' + v;
        return v;
    }
}

function getVestingShares(account) {
    var effective_vesting_shares = parseFloat(account.vesting_shares.replace(" VESTS", ""))
        + parseFloat(account.received_vesting_shares.replace(" VESTS", ""))
        - parseFloat(account.delegated_vesting_shares.replace(" VESTS", ""));
    return effective_vesting_shares;
}

var error_count = 0;
exports.ApiCall = function (method, account, from, to) {
    return client.database.call(method, [account, from, to])
        .then(r => { return r })
        .catch(message => {
            message = message.message;
            // Don't count assert exceptions for node failover
            if (message.indexOf('assert_exception') < 0 && message.indexOf('ERR_ASSERTION') < 0) {
                error_count++;

                log('Error Count: ' + error_count + ', Current node: ' + rpc_node);
                log(message);
            }

            return message
        })
}

function checkErrors() {
    if (error_count >= 10) {
        clearInterval(interval)
        setTimeout(main, 5 * 60 * 1000)
        let interval = setInterval(main, 30 * 1000)
    }
    // Reset the error counter
    error_count = 0;
}
exports.checkErrors = checkErrors;

exports.addMonth = function (x) {
    var dt = new Date();
    return dt.setMonth(dt.getMonth() + x)
}


// Load the price feed data
exports.priceFeed = async () => {

    await axios.get('https://api.coinmarketcap.com/v1/ticker/steem/')
        .then((r) => {

            steem_price = parseFloat(r.data[0].price_usd);

            console.log("Loaded STEEM price: " + steem_price);
        })
        .catch((err) => {
            console.log('Error loading STEEM price: ' + err);
        })

    await axios.get('https://api.coinmarketcap.com/v1/ticker/steem-dollars/')
        .then((r) => {
            sbd_price = parseFloat(r.data[0].price_usd);

            console.log("Loaded SBD price: " + sbd_price);
        })
        .catch((err) => {
            console.log('Error loading SBD price: ' + err);
        })

    return { sbd: sbd_price, steem: steem_price }
}

exports.checkVoted = function (author, permlink) {
    return client.database.call('get_active_votes', [author, permlink]).then(result => {

        let check = result.find(voter => {
            const name = voter.voter;
            const time = new Date(voter.time).toDateString();
            return name === BOTNAME;
        });

        if (!check) {
            return false
        } else
            return true
    })
}

function log(msg) { console.log(new Date().toString() + ' - ' + msg); }
exports.log = log;
