// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Two-player escrow with house-signed settlement and timeout refunds.
///
/// Chain-agnostic by design: no block.chainid guard, unlike PracticeDeposit.
/// LitVM mainnet is a constructor/env swap (house address + entry config), not a
/// rewrite — the contract must not encode LiteForge's 4441.
///
/// Match id is chosen by the opener and must be unique; use
/// keccak256(abi.encodePacked(opener, nonce)). The house signature commits to
/// (block.chainid, id, winner), so a settlement cannot replay onto another chain
/// or another match.
contract Settlement {
    uint256 public constant ENTRY = 0.001 ether;
    uint64 public constant JOIN_GRACE = 1 hours;
    uint64 public constant CLAIM_GRACE = 1 days;

    address public immutable house;

    enum State { None, Open, Funded, Settled, Refunded }

    struct Match {
        address a;
        address b;
        uint64 deadline;
        State state;
    }

    mapping(bytes32 => Match) public matches;
    mapping(address => bytes32) public openMatch;

    event MatchOpened(bytes32 indexed id, address indexed a, uint256 amount, uint64 deadline);
    event MatchJoined(bytes32 indexed id, address indexed b, uint64 deadline);
    event MatchSettled(bytes32 indexed id, address indexed winner, uint256 amount);
    event MatchRefunded(bytes32 indexed id, address indexed by, address a, address b, uint256 amount);

    constructor(address house_) {
        require(house_ != address(0), "House address required");
        house = house_;
    }

    function open(bytes32 id) external payable {
        require(msg.value == ENTRY, "Use exact entry amount");
        require(matches[id].state == State.None, "Match id already used");
        require(openMatch[msg.sender] == bytes32(0), "Close your open match first");
        uint64 deadline = uint64(block.timestamp + JOIN_GRACE);
        matches[id] = Match(msg.sender, address(0), deadline, State.Open);
        openMatch[msg.sender] = id;
        emit MatchOpened(id, msg.sender, msg.value, deadline);
    }

    function join(bytes32 id) external payable {
        Match storage m = matches[id];
        require(msg.value == ENTRY, "Use exact entry amount");
        require(m.state == State.Open, "Match is not open");
        require(block.timestamp <= m.deadline, "Join window closed");
        require(msg.sender != m.a, "Opener cannot join own match");
        require(openMatch[msg.sender] == bytes32(0), "Close your open match first");
        uint64 deadline = uint64(block.timestamp + CLAIM_GRACE);
        m.b = msg.sender;
        m.deadline = deadline;
        m.state = State.Funded;
        openMatch[msg.sender] = id;
        emit MatchJoined(id, msg.sender, deadline);
    }

    /// Settle is valid only while the claim window is open, so an absent house
    /// can never take a pot after the refund deadline has passed.
    function settle(bytes32 id, address winner, bytes calldata sig) external {
        Match storage m = matches[id];
        require(m.state == State.Funded, "Match is not funded");
        require(block.timestamp <= m.deadline, "Claim window closed");
        require(winner == m.a || winner == m.b, "Winner must be a player");
        require(_signer(id, winner, sig) == house, "Settlement not signed by house");
        m.state = State.Settled;
        delete openMatch[m.a];
        delete openMatch[m.b];
        uint256 pot = ENTRY * 2;
        (bool ok, ) = payable(winner).call{value: pot}("");
        require(ok, "Payout failed");
        emit MatchSettled(id, winner, pot);
    }

    function refund(bytes32 id) external {
        Match storage m = matches[id];
        require(m.state == State.Open || m.state == State.Funded, "Match is not refundable");
        require(block.timestamp > m.deadline, "Before deadline");
        address a = m.a;
        address b = m.b;
        m.state = State.Refunded;
        delete openMatch[a];
        if (b != address(0)) delete openMatch[b];
        if (b != address(0)) {
            (bool okA, ) = payable(a).call{value: ENTRY}("");
            require(okA, "Refund failed");
            (bool okB, ) = payable(b).call{value: ENTRY}("");
            require(okB, "Refund failed");
        } else {
            (bool ok, ) = payable(a).call{value: ENTRY}("");
            require(ok, "Refund failed");
        }
        emit MatchRefunded(id, msg.sender, a, b, b == address(0) ? ENTRY : ENTRY * 2);
    }

    function cancel(bytes32 id) external {
        Match storage m = matches[id];
        require(m.state == State.Open, "Match is not open");
        require(msg.sender == m.a, "Only the opener can cancel");
        address a = m.a;
        m.state = State.Refunded;
        delete openMatch[a];
        (bool ok, ) = payable(a).call{value: ENTRY}("");
        require(ok, "Refund failed");
        emit MatchRefunded(id, a, a, address(0), ENTRY);
    }

    /// The 32 bytes the house actually signs: personal_sign of this value is
    /// what `digest` recovers, so the server signs `hashOf`, never `digest`.
    function hashOf(bytes32 id, address winner) public view returns (bytes32) {
        return keccak256(abi.encodePacked(block.chainid, id, winner));
    }

    function digest(bytes32 id, address winner) public view returns (bytes32) {
        return keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            hashOf(id, winner)
        ));
    }

    function _signer(bytes32 id, address winner, bytes calldata sig) internal view returns (address) {
        require(sig.length == 65, "Signature must be 65 bytes");
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        return ecrecover(digest(id, winner), v, r, s);
    }
}
