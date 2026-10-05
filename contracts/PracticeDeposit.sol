// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice LiteForge-only practice deposits. No house fee, scoring, or winnings.
contract PracticeDeposit {
    uint256 public constant ENTRY = 0.001 ether;
    mapping(address => uint256) public deposits;
    event Deposited(address indexed player, uint256 amount);
    event Refunded(address indexed player, uint256 amount);
    constructor() { require(block.chainid == 4441, "LiteForge only"); }
    function deposit() external payable {
        require(msg.value == ENTRY, "Use exact entry amount");
        require(deposits[msg.sender] == 0, "Refund existing deposit first");
        deposits[msg.sender] = msg.value;
        emit Deposited(msg.sender, msg.value);
    }
    function refund() external {
        uint256 amount = deposits[msg.sender];
        require(amount != 0, "No deposit");
        deposits[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Refund failed");
        emit Refunded(msg.sender, amount);
    }
}
