In /apps/trade

## Task:

Trade app accepts /v1/market POST data commands to buy or sell a cryptocurrency such as XRP or XRP. It uses DYDX decentralized exchange. The API that it uses to manage orders is old. It needs to be updated.

Update the current market logic in `./apps/trade/dydx` to use the latest DYDX Composite Client.

Update the v4-client-js TypeScript client library from v1 to v3. Latest version is v4-client-js@v3.4.0

## Research:

The JavaScript / TypeScript library we need to use:
https://github.com/dydxprotocol/v4-clients/tree/main/v4-client-js

Documentation for DYDX and TypeScript "Composite Client":
https://docs.dydx.xyz/interaction/client/quick-start-ts
https://docs.dydx.xyz/interaction/endpoints#composite-client-typescript-only

This TypeScript Composite Client takes care of the complexity of matching a new order to the orderbook. It manages the submitted order, executes it if possible. If not possible, then we are not able to know that it failed. But that's ok. We can simply poll the latest status after 30 seconds or so, to check if the order was successfully executed.

## Development:

In the ./app/trade/.env file is the DYDX_MNEMONIC environment variable needed to connect to the live production DYDX account. Go ahead and call the code via API. Create any API endpoints to help you understand and troubleshoot the client connection.

Look at the unit tests for examples how this is intended to be used. Add examples and update as needed.

POST request is sent to /v1/market with the intended ticker and position size.
POST data is plain text. It must be parsed. This does not need updating. It already works well.

**Example POST data**

**xrp:100**
Long position $100 dollars of XRP. Long because number is positive. Place a market order for $100 dollars of XRP (convert to how many tokens that would be, send the amount in
tokens).

**xrp:200**
User wants long position of $200 dollars of XRP. Again, long because it's positive. We already have a position worth $100 in the account. So, only add $100 more!

**xrp:-100**
User wants short position worth $100 dollars of XRP. This is a short position, because the number is negative. So, add

**xrp:0**
Zero means to close whatever position we have. The calculation is the same. If our current position is long $100, then submit a new market order to short $100. If our position is short $100, then submit a new market order to long $100. DYDX is very very simple. Short positions are subtracted from long, and long are subtracted from short. To close a position, you must submit the opposite side with the same number of tokens as the current position value. The big difference with this Zero directive `xrp:0` execution is we must use "reduce only" option. Because of rounding errors, or potential mistakes, if user wants to close a position, we want to make sure not to accidentally make a position opposite
to the current one (by adding or subtracting a number that's too high). The "reduce only" option prevents a larger SHORT side order from reversing the current LONG position. It will simply close out to 0.

Note: Because dollar amounts must be converted to fractions of a crypto token, DYDX rounds the number of tokens to the nearest "tick". It is different for each crypto. For SOL, it's 1/10. For smaller coins like XRP or ADA, it's much smaller (more precise) decimal like 1/1000. It's ok if we do not get an exact fill. Do not try again! Simply run the order once when the user sends a new position request via POST /v1/market. If it doesn't get filled at all, or not fully, that's ok.

## Validation:

Make sure you can execute the above examples with the real DYDX account using the DYDX_MNEMONIC environment variable to connect.

After testing, make sure to bring the position balance back to 0. If it does not go back to 0, then continue improving the implementation until you are able to close the position back to 0.

The trade app also has a status page at `apps/trade/fe/pages/PageAccount.tsx`.
It uses the same DYDX Class to read the account position, orders, and info.
This should also work with the new version.

## Testing:

A few tests already exist. They are very generic simple cases. They should still pass after the version upgrade.

## Notes:

DYDX takes a longer time to respond than a traditional web server. This is because it's decentralized.

IMPORTANT: DYDX is not allowed to be used inside the USA. So, if you are testing using the DYDX_MNEMONIC (real account), it may possibly deny access. I am running this on my local computer, via VPN through outside the USA. But there is a chance that Claude Code AI agent may execute some part of it on a US server in the cloud. In that case, every request to DYDX will reply with something like "access denied". In that case, stop trying to connect using the real Mnemonic, and simply try to wrap up the work as well as possible without real life testing.
