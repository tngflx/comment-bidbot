const dsteem = require('dsteem')
global.rpc_node = 'https://api.steemit.com'

const { BlockchainMode } = require('dsteem')
require('dotenv').config()
const { ApiCall } = require('./utils')
const utils = require('./utils')
const mongo = require('./mongo')
let { estEarn, main, failedBids, getAPR } = require('./logics')
require('heroku-self-ping')("https://botname-comment-bot.herokuapp.com");

//connect to server which is connected to the network/testnet
const client = new dsteem.Client(rpc_node)
global.client = client;

let BOTNAME = process.env.BOTNAME;
let privateKey = dsteem.PrivateKey.fromString(process.env.KEY);
const Regex = new RegExp(/(^\d+|^\d+\.\d+)(SBD|STEEM)$/, 'i')
var totalVestingFund;
var totalVestingShares;
var VotingPower, VoteValue, timeTilFullPower;

/* @params1 = botname
* @params2 = type of operation
* @params3 = post/comment
* @params4 = amount in SBD/STEEM
*/

//Initialization of all steem variables and data
main().then(() => run())
global.runInterval = setInterval(main, 30 * 1000)

let http = require('http');
http.createServer(function (req, res) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('Hello World!');
    res.end();
}).listen(process.env.PORT || 8080)

async function run() {
    let operations = client.blockchain.getOperations({ mode: BlockchainMode.Latest })

    await client.database.getAccounts([BOTNAME]).then(function (result) {
        let account = result[0];

        VotingPower = utils.getVotingPower(account);
        VoteValue = utils.getVoteValue(100, account).toFixed(2);
        timeTilFullPower = utils.toTimer(utils.timeTilFullPower(VotingPower));
    })

    async function getComments() {
        for await (const operation of operations) {
            if (operation.op[0] === 'comment') {

                const comment = operation.op[1]
                const body = comment.body
                let match = /^(?:^|\s*@?([A-Za-z0-9.-]+))(?:\s*)!([A-Za-z]+)(?:\s+(\w+))(?:\s*)(\d+(?:\.|\d+|\w+)(?:\d+|\w+)+)?/g.exec(body)

                if (match) {
                    if ((match[1] === BOTNAME || "botname") && match[2] && (match[3] || match[4])) {
                        let cash = Regex.exec(match[4])

                        //Case for normal vote bidding
                        if (cash) {
                            if (cash[2] === "SBD" || "STEEM") {
                                console.log(comment)
                                processCommand(match[2], match[3], cash, comment)

                            }
                            //Case for delegation link
                        } else if (cash === null && !isNaN(match[3])) {
                            console.log(comment)
                            processCommand(match[2], null, match[3], comment)

                            //Case for bids query
                        } else if (cash === null && /\w+/.test(match[3])) {
                            console.log(comment)
                            processCommand(match[2], match[3], null, comment)

                            //Case for status query
                        } else if (cash === null && /\w+/.test(match[2])) {
                            console.log(comment)
                            processCommand(match[2], null, null, comment)
                        }

                    }
                }
            }
        }
    }

    console.log('botname-Comment bot running..')
    await getComments().catch(console.error)

    function processCommand(optype, target, cash, postInfo) {
        switch (optype) {
            case 'vote':
                const isPost = /^post$/.test(target);
                const isReply = /^reply$/.test(target);

                if (isPost === true) {
                    (async () => {
                        let currROI = await utils.getBotROI().then(r => {
                            return r;
                        });

                        client.database.call('get_content', [postInfo.author, postInfo.permlink])
                            .then(async r => {
                                const amount = cash[1]
                                const unitCash = cash[2].toUpperCase();
                                let memo = r.url.split('/')
                                let memo3 = memo[3].split('#')[0];
                                let Memo = 'https://steemit.com/' + memo[1] + '/' + memo[2] + '/' + memo3

                                let sclink = `https://steemconnect.com/sign/transfer?to=${BOTNAME}&amount=${amount}%20${unitCash}&memo=${Memo}`

                                utils.checkVoted(postInfo.parent_author, postInfo.parent_permlink)
                                    .then(check => {
                                        if (check === true) {
                                            let PostParams = {
                                                title: r.root_title,
                                                author: memo[2],
                                                parent_author: r.author,
                                                parent_permlink: r.permlink
                                            }

                                            sendComment(PostParams, 'votedb4')

                                        } else {
                                            let PostParams = {
                                                sclink: sclink,
                                                cash: cash[0],
                                                title: r.root_title,
                                                author: memo[2],
                                                currROI: currROI,
                                                timeTilFullPower: timeTilFullPower,
                                                parent_author: r.author,
                                                parent_permlink: r.permlink
                                            }
                                            sendComment(PostParams, 'post')

                                        }
                                    })


                            }).catch(console.error)
                    })();



                } else if (isReply === true) {
                    client.database.call('get_content', [postInfo.parent_author, postInfo.parent_permlink])
                        .then(r => {
                            const amount = cash[1]
                            const unitCash = cash[2]
                            let memo = 'https://steemit.com/' + r.url

                            let sclink = `https://steemconnect.com/sign/transfer?to=${BOTNAME}&amount=${amount}%20${unitCash}&memo=${memo}`

                            let ReplyParams = {
                                sclink: sclink,
                                cash: cash[0],
                                reply: r.body.substring(0, 20),
                                author: r.author,
                                parent_author: postInfo.author,
                                parent_permlink: postInfo.permlink

                            }
                            sendComment(ReplyParams, 'reply')
                        }).catch(console.error)
                }
                break;

            case 'delegate':
                const delegatee = BOTNAME;
                let DelParams, estSBD, estSTEEM, APR, SevDAPR;

                let sclink = `https://steemconnect.com/sign/delegateVestingShares?delegator=username&delegatee=${BOTNAME}&vesting_shares=${cash}%20SP`

                estEarn(cash).then(r => {
                    estSBD = r.estSBD.toFixed(3);
                    estSTEEM = r.estSTEEM.toFixed(3);
                    APR = r.APR.toFixed(2);
                    SevDAPR = r.SevDAPR.toFixed(2)
                }).then(() => {
                    DelParams = {
                        sclink: sclink,
                        cash: cash,
                        parent_author: postInfo.author,
                        parent_permlink: postInfo.permlink,
                        estSBD: estSBD,
                        estSTEEM: estSTEEM,
                        APR: APR,
                        SevDAPR: SevDAPR ? SevDAPR : ''
                    }
                    sendComment(DelParams, 'delegation')
                })

                break;

            case 'bid':

                if (target === 'fail') {
                    let result = failedBids(postInfo.author, /\w+/)

                    console.log(result);

                } else if (target === 'status') {

                    (async () => {
                        let currROI = await utils.getBotROI().then(r => {
                            return r
                        });

                        let statusParams = {
                            VP: VotingPower,
                            voteValue: VoteValue,
                            timeTillFullPower: timeTilFullPower,
                            currROI: currROI,
                            parent_author: postInfo.author,
                            parent_permlink: postInfo.permlink
                        }

                        await sendComment(statusParams, 'status')
                    })();
                }
                break;
        }
    }

    function sendComment(params, flag) {
        let { sclink, cash, title, reply, parent_permlink, parent_author,
            author, estSBD, estSTEEM, APR, SevDAPR, timeTilFullPower, voteValue, currROI, VP } = params;
        VP = VP / 100;
        let body, promo
        if (APR > 5) {
            //promo = '<img src=""> \n\n'
            promo = ''
        }

        if (flag === "post") {
            let msg;
            if (currROI > 0) {
                msg = `<b>ROI of current round is : ${currROI}%, and you have ${timeTilFullPower} to grab that sweet ROI</b> \n\n!`
            } else {
                msg = `<b>ROI of current round is : ${currROI}%, Time left for next round: ${timeTilFullPower}</b> \n\n`
            }

            body = `Click [this link](${sclink}) to bid an amount of <b>${cash}</b> for the post: <b>${title}</b> written by <b>${author}</b> \n\n` +
                msg + "Want to earn more with botname? Type <b>@botname !delegate SPYouHave</b> to get estimated earnings in SBD/STEEM \n\n" +
                "<h6><i>If you love this service, pass your ❤️ by giving this comment an upvote</i></h6>"

        } else if (flag === "votedb4") {
            body = `The post titled : <b>${title}</b> written by <b>${author}</b> has been upvoted before. Please try other post. \n\n` +
                "<h6><i>If you love this service, pass your ❤️ by giving this comment an upvote</i></h6>"

        } else if (flag === "reply") {
            body = `Click [this link](${sclink}) to bid an amount of <b>${cash}</b> for the reply: <b>${reply}</b> written by <b>${author}</b> \n\n` +
                msg + "Want to earn more with botname? Type <b>@botname !delegate SPYouHave</b> to get estimated earnings in SBD/STEEM \n\n" +
                "<h6><i>If you love this service, pass your ❤️ by giving this comment an upvote</i></h6>"

        } else if (flag === "delegation") {

            body = `Click [this link](${sclink}) to delegate an amount of ${cash}SP \n\n` +
                `Based on current payout, You will receive daily <b>estimated</b> earnings of : \n\n` +
                `<b>APR/7 days: ${SevDAPR}% || APR/yesterday: ${APR}% || STEEM: ${estSTEEM} || SBD: ${estSBD}</b> \n\n` +
                "Please note that your profit is affected by current STEEM and SBD price" + promo +
                "<h6><i>If you love this service, pass your ❤️ by giving this comment an upvote</i></h6>"

        } else if (flag === "status") {
            let msg;
            if (isNaN(currROI)) {
                msg = `<li>${currROI}</li>`;
            } else {
                msg = `<li>Current ROI for an upvote :${currROI} after curation reward</li>`
            }

            body = `Hi @${parent_author}, this is the current status of bot : \n\n` +
                `<ul><li>Voting power : ${VP}%</li>` + `<li>Time until next vote : ${timeTilFullPower}</li>` + msg
                + `<li>Vote value : ${voteValue}$</li></ul>`
        }

        const permlink = Math.random()
            .toString(36)
            .substring(2);

        const comment = {
            author: BOTNAME,
            title: '',
            body: body,
            parent_author: parent_author,
            parent_permlink: parent_permlink,
            permlink: permlink,
            json_metadata: JSON.stringify({ "app": "botname/0.1.0", "format": "markdown", "tags": ["bidbot", "bot", "antiphish"] })
        };

        client.broadcast.comment(comment, privateKey)
            .then(console.log('Posted comment'))
            .catch(console.error)
    }

}

