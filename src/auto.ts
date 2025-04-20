import Web3 from "web3";
import { ZERO_BYTES32, networks } from "../configs/networks";
import * as dotenv from "dotenv";
import { initializeFlareSystemsManager } from "../lib/initialize";
import { signUptimeVote, signRewards, getRewardsData, getUptimeVoteHash } from "./sign";
import { getEpochRange } from "./status";
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;
const RETRY_DELAY = 30 * 1000; // 30 seconds
const STATE_FILE = path.join(process.cwd(), '.signing-tool-state.json');

interface SigningState {
    lastCompletedEpoch: number;
}

function loadState(): SigningState {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading state:', error);
    }
    return { lastCompletedEpoch: -1 };
}

function saveState(state: SigningState) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (error) {
        console.error('Error saving state:', error);
    }
}

function getTimestamp(): string {
    return new Date().toISOString();
}

async function checkAndSign(web3: Web3, flareSystemsManagerAddress: string) {
    try {
        const flareSystemsManager = await initializeFlareSystemsManager(web3, flareSystemsManagerAddress);
        const currentRewardEpochId = Number(await flareSystemsManager.methods.getCurrentRewardEpochId().call());
        
        // Load the last completed epoch from state
        const state = loadState();
        const startEpoch = Math.max(state.lastCompletedEpoch + 1, currentRewardEpochId - 4);
        
        console.log(`\n[${getTimestamp()}] === Checking epochs ${startEpoch} to ${currentRewardEpochId} ===`);
        console.log(`[${getTimestamp()}] Last completed epoch: ${state.lastCompletedEpoch}`);
        
        let lastFullyCompletedEpoch = state.lastCompletedEpoch;
        
        for (let epochId = startEpoch; epochId <= currentRewardEpochId; epochId++) {
            console.log(`\n[${getTimestamp()}] --- Checking epoch ${epochId} ---`);
            
            let epochNotEnded = false;
            let epochFullyCompleted = true;
            
            // Check uptime vote status
            const uptimeVoteHash = await flareSystemsManager.methods.uptimeVoteHash(epochId).call();
            const isUptimeHash = uptimeVoteHash && uptimeVoteHash.toString() !== ZERO_BYTES32;
            
            if (isUptimeHash) {
                console.log(`[${getTimestamp()}] ✓ Uptime vote already signed for epoch ${epochId}`);
            } else {
                console.log(`[${getTimestamp()}] ⚠ Uptime vote not signed for epoch ${epochId}`);
                console.log(`[${getTimestamp()}] Attempting to sign uptime vote...`);
                const fakeVoteHash = await getUptimeVoteHash(web3);
                try {
                    await signUptimeVote(web3, flareSystemsManagerAddress, epochId, fakeVoteHash);
                    console.log(`[${getTimestamp()}] ✓ Uptime vote signed successfully for epoch ${epochId}`);
                } catch (error: any) {
                    // Check if the error message contains "epoch not ended"
                    if (error.reason?.includes('epoch not ended') || error.message?.includes('epoch not ended')) {
                        console.log(`[${getTimestamp()}] ⚠ Epoch ${epochId} has not ended yet, skipping rewards signing`);
                        epochNotEnded = true;
                        epochFullyCompleted = false;
                    } else {
                        console.error(`[${getTimestamp()}] ✗ Failed to sign uptime vote for epoch ${epochId}:`, error);
                        epochFullyCompleted = false;
                    }
                }
            }
            
            // Skip rewards if epoch hasn't ended yet
            if (epochNotEnded) {
                console.log(`[${getTimestamp()}] Skipping remaining epochs as epoch ${epochId} has not ended yet`);
                break;
            }
            
            // Check rewards status
            const rewardsHash = await flareSystemsManager.methods.rewardsHash(epochId).call();
            const isRewardsHash = rewardsHash && rewardsHash.toString() !== ZERO_BYTES32;
            
            if (isRewardsHash) {
                console.log(`[${getTimestamp()}] ✓ Rewards already signed for epoch ${epochId}`);
            } else {
                console.log(`[${getTimestamp()}] ⚠ Rewards not signed for epoch ${epochId}`);
                try {
                    console.log(`[${getTimestamp()}] Attempting to fetch and sign rewards...`);
                    const [rewardsHash, noOfWeightBasedClaims] = await getRewardsData(epochId);
                    await signRewards(web3, flareSystemsManagerAddress, epochId, rewardsHash, noOfWeightBasedClaims);
                    console.log(`[${getTimestamp()}] ✓ Rewards signed successfully for epoch ${epochId}`);
                } catch (error) {
                    console.error(`[${getTimestamp()}] ✗ Failed to sign rewards for epoch ${epochId}:`, error);
                    // If we can't sign rewards for this epoch, we can't sign for later epochs either
                    console.log(`[${getTimestamp()}] Skipping remaining epochs as epoch ${epochId} is not yet complete`);
                    epochFullyCompleted = false;
                    break;
                }
            }
            
            // Update last completed epoch if this one is fully completed
            if (epochFullyCompleted) {
                lastFullyCompletedEpoch = epochId;
                saveState({ lastCompletedEpoch: lastFullyCompletedEpoch });
            }
        }
        console.log(`\n[${getTimestamp()}] === Check complete ===\n`);
    } catch (error) {
        console.error(`[${getTimestamp()}] Error in checkAndSign:`, error);
    }
}

async function runWithRetry(web3: Web3, flareSystemsManagerAddress: string) {
    let retries = 0;
    
    while (retries < MAX_RETRIES) {
        try {
            await checkAndSign(web3, flareSystemsManagerAddress);
            return;
        } catch (error) {
            retries++;
            console.error(`[${getTimestamp()}] Attempt ${retries} failed:`, error);
            if (retries < MAX_RETRIES) {
                console.log(`[${getTimestamp()}] Retrying in ${RETRY_DELAY/1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            }
        }
    }
    
    console.error(`[${getTimestamp()}] Max retries reached. Will try again in next interval.`);
}

export async function startAutoSigning(web3: Web3, flareSystemsManagerAddress: string) {
    console.log(`[${getTimestamp()}] Starting automated signing process...`);
    console.log(`[${getTimestamp()}] Will check every ${CHECK_INTERVAL/60000} minutes`);
    
    // Run immediately on startup
    await runWithRetry(web3, flareSystemsManagerAddress);
    
    // Then run periodically
    setInterval(async () => {
        await runWithRetry(web3, flareSystemsManagerAddress);
    }, CHECK_INTERVAL);
} 