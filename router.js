import express from "express";
import Member from "./wallets.js";
import Droptip from "./droptips.js";

const router = express.Router();

/**
 * @route POST /api/wallets
 * @desc Save or update a user's wallet
 */
router.post("/wallets/newWallet", async (req, res) => {
    const { userId, wallet} = req.body;

    if (!userId || !wallet) {
        return res.status(400).json({ error: "Missing required fields" });
    }
    console.log( 'done checking')
    try {
        let user = await Member.findOne({ UserId: userId.toString() }); // Ensure string match
        console.log('checking again')
        if (!user) {
            user = new Member({ UserId: userId.toString(), wallet: {privateKey: wallet.privateKey, walletobj: wallet.walletobj} });
            await user.save();
            console.log(`Wallet saved successfully: ${wallet.address}`);
            return res.status(201).json({ message: "Wallet saved successfully", walletobj: wallet.walletobj });
        } else {
            return res.status(409).json({ message: "Wallet already exists" });
        }
    } catch (err) {
        console.error(`Error saving wallet: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});


router.post("/droptips/newDroptip", async (req, res) => {
    const { droptipId, droptip } = req.body;
    
    if (!droptipId || !droptip) {
        return res.status(400).json({ error: "Missing required fields" });
    }
    try{
        let drop = new Droptip({ droptipId: droptipId.toString(), droptip: droptip });
        await drop.save();
        res.status(200).json({message: "Wallet Saved Sucessfully", droptipId, droptip});
    }catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @route GET /api/wallets/:userId
 * @desc Retrieve all wallets for a user
 */
router.get("/wallets/privatekey/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        console.log(`Searching for wallet with user ID: ${userId}`); // Debugging log

        const user = await Member.findOne({ UserId: userId.toString() }); // Ensure string match

        if (!user) {
            console.log(`No wallet found for user ID: ${userId}`);
            return res.status(404).json({ error: "Wallet not found" });
        }

        console.log(`Wallet found: ${JSON.stringify(user.wallet.walletobj.address)}`);
        res.status(200).json({ wallet: user.wallet.privateKey });
    } catch (err) {
        console.error(`Error fetching wallet: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});
router.get("/wallets/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        console.log(`Searching for wallet with user ID: ${userId}`); // Debugging log

        const user = await Member.findOne({ UserId: userId.toString() }); // Ensure string match

        if (!user) {
            console.log(`No wallet found for user ID: ${userId}`);
            return res.status(404).json({ error: "Wallet not found" });
        }

        console.log(`Wallet found: ${JSON.stringify(user.wallet.walletobj.address)}`);
        res.status(200).json({ wallet: user.wallet.walletobj });
    } catch (err) {
        console.error(`Error fetching wallet: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});



router.get("/droptips/:droptipId", async (req, res) => {
    const { droptipId } = req.params;

    try {
        const drop = await Droptip.findOne({ droptipId: droptipId});

        if (!drop) {
            return res.status(404).json({ error: "drop not found" });
        }
        res.status(200).json({droptipId: droptipId, droptip: drop.droptip});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.post("/droptips/updateDroptip", async (req, res) => {
    const { droptipId, droptip } = req.body;

    try {
        const updatedDrop = await Droptip.findOneAndUpdate(
            { droptipId }, 
            { $set: { droptip } }, 
            { new: true } // Returns the updated document
        );

        if (!updatedDrop) {
            return res.status(404).json({ error: "Droptip not found" });
        }

        res.status(200).json({ message: `${droptipId} updated successfully`, updatedDrop });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * @route DELETE /api/wallets
 * @desc Remove a specific wallet for a user
 */
router.delete("/", async (req, res) => {
    const { userId, blockchain } = req.body;

    if (!userId || !blockchain) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        let member = await Member.findOne({ userId });

        if (!member || !member.wallets.has(blockchain)) {
            return res.status(404).json({ error: "Wallet not found" });
        }

        member.wallets.delete(blockchain);
        await member.save();

        res.json({ message: "Wallet deleted successfully!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
