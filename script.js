// ==========================
// 💡 NEW: FIREBASE CONFIGURATION & SETUP
// ==========================
const firebaseConfig = {
    apiKey: "AIzaSyBAnSU2l_6VGL-MQunS_MO9t8ksvNhGwcU",
    authDomain: "generala-multiplayer-661b5.firebaseapp.com",
    databaseURL: "https://generala-multiplayer-661b5-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "generala-multiplayer-661b5",
    storageBucket: "generala-multiplayer-661b5.firebasestorage.app",
    messagingSenderId: "395775289124",
    appId: "1:395775289124:web:631d38f9d9890723d675b1",
};

// Single static room ID for simple friend play
const GAME_ROOM_ID = 'generala_static_single_room_final'; 
let db = null;
let gameRef = null;
const myPlayerId = 'P-' + Date.now().toString() + Math.random().toString(36).substring(2, 9); 
let myPlayerIndex = -1; // The index of this player in the GAME_STATE.players array
let countdownInterval = null;
let requiredPlayerCount = 0; // Number of players required for this game

try {
    const app = firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    gameRef = db.ref('generala_rooms/' + GAME_ROOM_ID);
} catch (e) {
    console.error("Firebase init failed:", e);
    showAlertModal("Error connecting to the online game server.");
}

// 💡 NEW: GLOBAL GAME STATE (Local variables converted to a synced object)
let GAME_STATE = {
    players: [],
    currentPlayer: 0,
    dice: [1, 1, 1, 1, 1],
    held: [false, false, false, false, false],
    rollsLeft: 3,
    rolledOnce: false,
    gameActive: false, // New flag for multiplayer
    countdown: 30,     // 30-second countdown as requested
    hostPlayerNames: []
};

const categories = [
    "ones", "twos", "threes", "fours", "fives", "sixes",
    "ladder", "full", "poker", "generala", "doubleGenerala"
];

// 💡 NEW: FUNCTION TO PUSH STATE TO FIREBASE
function updateFirebaseState() {
    if (gameRef) {
        gameRef.set(GAME_STATE);
    }
}

// 💡 NEW: MAIN UI RENDERER (Called every time Firebase updates)
function renderUI(animateDice = false) {
    const { players, gameActive, countdown, hostPlayerNames } = GAME_STATE;

    // Determine current screen visibility
    const isGameScreen = gameActive;
    document.getElementById("setup-screen").classList.toggle("active", !isGameScreen);
    document.getElementById("game-screen").classList.toggle("active", isGameScreen);
    document.getElementById("end-screen").classList.remove("active");

    if (!gameActive) {
        // Handle Setup Screen status
        const statusDiv = document.getElementById("waiting-status");
        if (players.length > 0) {
            const joinedCount = players.filter(p => p.id !== null).length;
            const requiredCount = hostPlayerNames.length || requiredPlayerCount;

            if (joinedCount < requiredCount) {
                statusDiv.innerHTML = `Waiting for ${requiredCount - joinedCount} more player(s). Game starts in: <span style="font-size: 24px;">${countdown}</span>`;
            } else if (countdown > 0) {
                statusDiv.innerHTML = `All players joined! Game starting in: <span style="font-size: 24px;">${countdown}</span>`;
            } else {
                 statusDiv.innerHTML = `Starting game...`;
            }
        } else {
             statusDiv.innerHTML = `Click 'Start Game' to create a new session.`;
        }
    } else {
        // Handle Game Screen
        if (players.length > 0) {
            buildScoreboard(); 
            renderDice(animateDice); 
            updateTurnBanner(); 
            // FIX: Rolls left is now synced
            document.getElementById("rolls-left").innerText = GAME_STATE.rollsLeft;
        }
        if (isGameOver()) endGame();
    }
}

// ==========================
// SETUP SCREEN (MODIFIED FOR ONLINE JOIN)
// ==========================
const playerCountSelect = document.getElementById("player-count");
const playerNamesDiv = document.getElementById("player-names");
const startGameBtn = document.getElementById("start-game-btn");

playerCountSelect.onchange = generateNameInputs;
generateNameInputs();

function generateNameInputs() {
    playerNamesDiv.innerHTML = "";
    requiredPlayerCount = Number(playerCountSelect.value);
    for (let i = 1; i <= requiredPlayerCount; i++) {
        // Use a default name to simplify setup
        playerNamesDiv.innerHTML += `<input id="p${i}" placeholder="Player ${i} name" value="Player ${i}">`;
    }
}

startGameBtn.onclick = () => {
    const count = Number(playerCountSelect.value);
    let tempPlayerNames = [];
    let tempPlayers = [];

    // 1. Validate and create local player list
    for (let i = 1; i <= count; i++) {
        const input = document.getElementById("p" + i);
        if (!input) return showAlertModal("Player name inputs were not generated correctly.");
        
        const name = input.value.trim();
        if (!name) return showAlertModal(`Player ${i} must enter a name.`);
        
        tempPlayerNames.push(name);
        
        tempPlayers.push({
            name,
            id: null, // Will be set to myPlayerId upon joining a slot
            scores: categories.reduce((acc, cat) => ({...acc, [cat]: null}), {})
        });
    }

    // 2. Start Firebase Listener (always listen before acting)
    setupFirebaseListener();

    // 3. Check/Initialize Firebase State
    gameRef.once('value', (snapshot) => {
        const syncedState = snapshot.val();
        
        if (!syncedState || syncedState.players.length === 0 || !syncedState.gameActive) {
            // A. HOST: Initialize the game state (new game)
            GAME_STATE = { 
                ...GAME_STATE, 
                players: tempPlayers,
                hostPlayerNames: tempPlayerNames,
                gameActive: false,
                countdown: 30
            };
            
            // Assign this device to the first player slot
            GAME_STATE.players[0].id = myPlayerId;
            myPlayerIndex = 0;
            
            updateFirebaseState();
            showAlertModal(`You are Player 1. Game initialized for ${count} players.`);
            
        } else {
            // B. CLIENT: Joining an existing game
            
            // Validate that local names match the synced state names
            const requiredNames = syncedState.hostPlayerNames;

            if (requiredNames.length !== count) {
                return showAlertModal(`The game is set for ${requiredNames.length} players. Please adjust the player count and names to match.`);
            }

            // Check if local names match the required names in order
            for(let i = 0; i < count; i++) {
                if (requiredNames[i] !== tempPlayerNames[i]) {
                    return showAlertModal("Player names entered do not match the current game setup. All names must be exactly the same.");
                }
            }

            // Find the slot this player belongs to
            let foundIndex = -1;
            
            // 1. Check if this player is already in a slot (re-joining logic)
            const existingIndex = syncedState.players.findIndex(p => p.id === myPlayerId);
            if (existingIndex > -1) {
                 foundIndex = existingIndex; 
            } else {
                // 2. Find the first empty slot that matches the local name list
                 for(let i = 0; i < count; i++) {
                     // Check if the slot name matches and the slot is empty (id is null)
                     if (syncedState.players[i].name === tempPlayerNames[i] && syncedState.players[i].id === null) {
                         foundIndex = i;
                         break;
                     }
                 }
            }
            
            if (foundIndex > -1) {
                // Join the slot
                GAME_STATE = syncedState;
                myPlayerIndex = foundIndex;
                GAME_STATE.players[myPlayerIndex].id = myPlayerId;
                updateFirebaseState();
                showAlertModal(`You have joined the game as Player ${myPlayerIndex + 1}!`);
            } else {
                // All slots taken or names don't match
                let isFull = syncedState.players.every(p => p.id !== null);
                if (isFull) {
                    return showAlertModal("All player slots are currently occupied.");
                } else {
                    return showAlertModal("Error joining: Slot not found. Check names and player count.");
                }
            }
        }
        
        // After joining/hosting, check if we need to start the countdown
        checkAndStartCountdown();
    });
};

// 💡 NEW: FIREBASE LISTENER 
function setupFirebaseListener() {
    // Only listen once
    gameRef.off('value'); 
    gameRef.on('value', (snapshot) => {
        const syncedState = snapshot.val();
        if (syncedState) {
            // Overwrite local state with synced state
            GAME_STATE = syncedState;
            
            // Find my index based on the session ID in the synced state
            const me = GAME_STATE.players.find(p => p.id === myPlayerId);
            myPlayerIndex = me ? GAME_STATE.players.indexOf(me) : -1;

            // Check if we need to start/stop the countdown based on synced state
            checkAndStartCountdown(true);
            
            // Call the main UI render function
            renderUI();
        }
    });
}

function checkAndStartCountdown(isSyncedUpdate = false) {
    if (!GAME_STATE.gameActive && GAME_STATE.players.length > 0) {
        const requiredCount = GAME_STATE.hostPlayerNames.length;
        const joinedCount = GAME_STATE.players.filter(p => p.id !== null).length;

        if (joinedCount >= 2 && joinedCount === requiredCount) {
            // All players joined, start countdown if it's not running
            if (!countdownInterval) {
                if (!isSyncedUpdate) { // Only the host should initiate the countdown
                    GAME_STATE.countdown = 30; // Reset just in case
                    updateFirebaseState();
                }
                
                // Start local interval (only runs on one device, but we check all the time)
                if(myPlayerIndex === 0) startCountdownInterval(); 
            }
        } else if (joinedCount >= 2 && !countdownInterval) {
            // Start countdown when minimum 2 players join, even if not full
            if(myPlayerIndex === 0) startCountdownInterval();
        } else if (joinedCount < 2 && countdownInterval) {
            // Not enough players, pause/reset countdown
            clearInterval(countdownInterval);
            countdownInterval = null;
            if (GAME_STATE.countdown !== 30) {
                GAME_STATE.countdown = 30; 
                if(myPlayerIndex === 0) updateFirebaseState();
            }
        }
    }
}

function startCountdownInterval() {
    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        if (GAME_STATE.players.filter(p => p.id !== null).length < 2) {
             clearInterval(countdownInterval);
             countdownInterval = null;
             GAME_STATE.countdown = 30;
             updateFirebaseState();
             return;
        }

        GAME_STATE.countdown--;
        if (GAME_STATE.countdown <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
            GAME_STATE.gameActive = true;
            GAME_STATE.currentPlayer = 0;
            updateFirebaseState(); // Trigger game start
        } else {
            updateFirebaseState(); // Sync countdown change
        }
    }, 1000);
}


// ==========================
// SCOREBOARD GENERATION
// ==========================
function buildScoreboard() {
    const { players, currentPlayer } = GAME_STATE;

    const header = document.getElementById("score-header");
    const body = document.getElementById("score-body");

    let hRow = "<tr><th>Category</th>";
    players.forEach(p => hRow += `<th>${p.name}</th>`);
    hRow += "</tr>";
    header.innerHTML = hRow;

    body.innerHTML = "";
    categories.forEach(cat => {
        let row = `<tr><td>${formatCat(cat)}</td>`;
        players.forEach((p, i) => {
            // FIX: Display score from state, or empty if null
            let content = p.scores[cat] !== null ? p.scores[cat] : "";
            let classes = "clickable";
            if (p.scores[cat] !== null) classes += " filled";
            
            // Store player index on the cell
            row += `<td data-player-index="${i}" data-cat="${cat}" class="${classes}">${content}</td>`;
        });
        row += "</tr>";
        body.innerHTML += row;
    });

    // Re-attach event listeners only for the current player's turn on their device
    document.querySelectorAll("#score-body td.clickable").forEach(cell => {
        const playerIndex = Number(cell.dataset.playerIndex);
        
        // Check if it's my turn
        if (playerIndex === GAME_STATE.currentPlayer && playerIndex === myPlayerIndex) {
            cell.onclick = () => scoreCategory(cell);
        } else {
            // Prevent scoring when it's not the local player's turn
            cell.onclick = () => {
                 showAlertModal("It's not your turn!");
            }
        }
    });
    
    updatePossibleScores();
}

// Format category names nicely (YOUR ORIGINAL CODE)
function formatCat(cat) {
    return {
        ones: "Ones", twos: "Twos", threes: "Threes", fours: "Fours", fives: "Fives", sixes: "Sixes",
        ladder: "Ladder", full: "Full House", poker: "Poker", generala: "Generala", doubleGenerala: "Double Generala"
    }[cat];
}

// ==========================
// TURN SYSTEM
// ==========================
const turnBanner = document.getElementById("turn-banner");
function updateTurnBanner() {
    const { players, currentPlayer } = GAME_STATE;
    if (players[currentPlayer]) {
        const isMe = currentPlayer === myPlayerIndex ? "(YOU)" : "";
        turnBanner.innerHTML = `🎲 ${players[currentPlayer].name}'s Turn ${isMe}`;
    }
}

// ==========================
// DICE FUNCTIONS
// ==========================
const diceDivs = document.querySelectorAll(".die");

diceDivs.forEach(die => {
    die.onclick = () => {
        const i = Number(die.dataset.index);
        const { rollsLeft, currentPlayer } = GAME_STATE;

        // Check turn permission
        if (currentPlayer !== myPlayerIndex) {
            return showAlertModal("It's not your turn!");
        }

        if (rollsLeft < 3) {
            // FIX: Update state and sync immediately.
            GAME_STATE.held[i] = !GAME_STATE.held[i];
            updateFirebaseState();
        }
    };
});

document.getElementById("roll-btn").onclick = () => {
    const { rollsLeft, held, currentPlayer } = GAME_STATE;

    if (currentPlayer !== myPlayerIndex) {
        return showAlertModal("It's not your turn!");
    }
    if (rollsLeft === 0) return showAlertModal("No rolls left this turn.");

    // Update local dice and rollsLeft in GAME_STATE
    GAME_STATE.dice.forEach((_, i) => {
        if (!held[i]) GAME_STATE.dice[i] = Math.floor(Math.random() * 6) + 1;
    });

    GAME_STATE.rollsLeft--;
    GAME_STATE.rolledOnce = true;

    // Sync the new state (dice values, rollsLeft, rolledOnce)
    updateFirebaseState();
    
    // Rerender immediately to show animation locally
    renderDice(true); 
};

// RENDER DICE WITH DOTS (FIXED for reliable dot and color rendering)
function renderDice(animate = false) {
    const { dice, held } = GAME_STATE;
    const patterns = {
        1: [[0,0,0],[0,1,0],[0,0,0]],
        2: [[1,0,0],[0,0,0],[0,0,1]],
        3: [[1,0,0],[0,1,0],[0,0,1]],
        4: [[1,0,1],[0,0,0],[1,0,1]],
        5: [[1,0,1],[0,1,0],[1,0,1]],
        6: [[1,0,1],[1,0,1],[1,0,1]]
    };

    diceDivs.forEach((div,i) => {
        // FIX: The dice divs are now reliably populated with dots on every render.
        div.innerHTML = "";
        // FIX: Held state is toggled from synced state
        div.classList.toggle("held", held[i]);
        div.classList.remove("roll-animate");

        const pat = patterns[dice[i]];
        for (let r=0;r<3;r++){
            for (let c=0;c<3;c++){
                const dot = document.createElement("div");
                dot.classList.add("dot");
                if (pat[r][c] === 0) dot.style.visibility="hidden";
                div.appendChild(dot);
            }
        }

        if (animate && !held[i]) {
            void div.offsetWidth;
            div.classList.add("roll-animate");
        }
    });
}

// ==========================
// SCORING LOGIC
// ==========================
function scoreCategory(cell) {
    const playerIndex = myPlayerIndex; // We only allow scoring for the local player
    const cat = cell.dataset.cat;
    const { players, rolledOnce } = GAME_STATE;

    if (!rolledOnce) return showAlertModal("You must roll at least once before scoring.");
    if (players[playerIndex].scores[cat] !== null) return showAlertModal("You already scored this category.");

    const score = calculateScore(cat);

    // Generala-specific rule check
    if(cat === "doubleGenerala" && players[playerIndex].scores["generala"] === null && score > 0){
        return showAlertModal("You can only score Double Generala after scoring Generala first.");
    }

    showConfirmModal(`Are you sure you want to score ${score} for ${formatCat(cat)}?`, () => {
        // Set score in local state
        GAME_STATE.players[playerIndex].scores[cat] = score;

        // Advance turn in local state
        nextTurn();
        
        // Sync the entire state change to Firebase
        updateFirebaseState();
    });
}

function calculateScore(cat) {
    const { dice } = GAME_STATE; // Use the synced dice array
    const counts = {};
    dice.forEach(d => counts[d] = (counts[d] || 0) + 1);

    switch (cat) {
        case "ones": return (counts[1]||0)*1;
        case "twos": return (counts[2]||0)*2;
        case "threes": return (counts[3]||0)*3;
        case "fours": return (counts[4]||0)*4;
        case "fives": return (counts[5]||0)*5;
        case "sixes": return (counts[6]||0)*6;
        case "ladder":
            const s=[...new Set(dice)].sort((a,b)=>a-b).join("");
            return (s==="12345" || s==="23456")?25:0;
        case "full":
            return Object.values(counts).includes(3) && Object.values(counts).includes(2)?30:0;
        case "poker":
            return Object.values(counts).includes(4)?40:0;
        case "generala":
            return Object.values(counts).includes(5)?50:0;
        case "doubleGenerala":
            return Object.values(counts).includes(5)?50:0;
        default: return 0;
    }
}


// ==========================
// UPDATE POSSIBLE SCORES (FIXED to show for current player)
// ==========================
function updatePossibleScores() {
    const { players, currentPlayer, rolledOnce } = GAME_STATE;

    document.querySelectorAll("#score-body td.clickable").forEach(cell => {
        const playerIndex = Number(cell.dataset.playerIndex);
        const cat = cell.dataset.cat;

        // If scored, show final score (white text)
        if(players[playerIndex].scores[cat] !== null) {
            cell.innerText = players[playerIndex].scores[cat];
            cell.style.color = "#fff"; 
            return;
        }
        
        // FIX: Show possible score for the CURRENT player's turn, only after a roll, and only on that player's screen
        if(playerIndex === currentPlayer && playerIndex === myPlayerIndex && rolledOnce){
            const possible = calculateScore(cat);
            cell.innerText = possible; 
            cell.style.color = "#ccc"; // Gray possible scores
        } else {
            // Clear for other players or non-current turns
            cell.innerText = "";
            cell.style.color = "#fff";
        }
    });
}

// ==========================
// TURN ADVANCING
// ==========================
function nextTurn() {
    // Reset state for the next player
    GAME_STATE.dice=[1,1,1,1,1];
    GAME_STATE.held=[false,false,false,false,false];
    GAME_STATE.rollsLeft=3;
    GAME_STATE.rolledOnce=false;

    // Advance player
    GAME_STATE.currentPlayer++;
    if(GAME_STATE.currentPlayer>=GAME_STATE.players.length) GAME_STATE.currentPlayer=0;

    if(isGameOver()) endGame();
}

function isGameOver(){
    return GAME_STATE.players.every(p => Object.values(p.scores).every(v => v!==null));
}

// ==========================
// END GAME
// ==========================
function endGame(){
    document.getElementById("game-screen").classList.remove("active");
    document.getElementById("end-screen").classList.add("active");

    // Sort players by total score descending
    const ranked = GAME_STATE.players.map(p=>{
        // Check if player slot is occupied
        if (p.id) {
            return {name:p.name, score:Object.values(p.scores).reduce((a,b)=>a+b,0)};
        }
        return {name:p.name, score:0};
    }).sort((a,b)=>b.score - a.score);

    let html = "<table style='margin:auto; width:80%; text-align:left;'><tr><th>Rank</th><th>Player</th><th>Score</th></tr>";
    ranked.forEach((p,i)=>{
        html += `<tr><td>${i+1}</td><td>${p.name}</td><td>${p.score}</td></tr>`;
    });
    html += "</table>";

    document.getElementById("leaderboard").innerHTML = html;
}

// ==========================
// MODALS
// ==========================
function showAlertModal(msg){
    const modal = document.getElementById("custom-modal");
    modal.querySelector("#modal-text").innerText = msg;
    modal.classList.add("show");

    const noBtn = modal.querySelector("#confirm-no");
    const yesBtn = modal.querySelector("#confirm-yes");

    noBtn.style.display="none";
    yesBtn.innerText="OK";

    yesBtn.onclick = () => { modal.classList.remove("show"); }
}

function showConfirmModal(msg,onConfirm){
    const modal = document.getElementById("custom-modal");
    modal.querySelector("#modal-text").innerText = msg;
    modal.classList.add("show");

    const yesBtn = modal.querySelector("#confirm-yes");
    const noBtn = modal.querySelector("#confirm-no");

    yesBtn.innerText="Yes";
    noBtn.style.display="inline-block";

    yesBtn.onclick=()=>{
        onConfirm();
        modal.classList.remove("show");
    }

    noBtn.onclick = ()=>{ modal.classList.remove("show"); }
}
