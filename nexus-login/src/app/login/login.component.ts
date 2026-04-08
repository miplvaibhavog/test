import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

interface Particle {
  left: string;
  duration: string;
  delay: string;
  size: string;
  color: string;
}

@Component({
  selector: 'app-login',
  imports: [FormsModule, CommonModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  email = '';
  password = '';
  rememberMe = false;
  showPassword = false;
  isLoading = false;
  particles: Particle[] = [];

  constructor() {
    this.generateParticles();
  }

  generateParticles(): void {
    for (let i = 0; i < 40; i++) {
      const rand = Math.random();
      let color = '#00f0ff';
      if (rand > 0.9) color = '#7b2fff';
      else if (rand > 0.7) color = '#ff00e5';

      this.particles.push({
        left: Math.random() * 100 + '%',
        duration: 6 + Math.random() * 10 + 's',
        delay: Math.random() * 10 + 's',
        size: 1 + Math.random() * 2 + 'px',
        color,
      });
    }
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  onSubmit(): void {
    if (this.isLoading) return;
    this.isLoading = true;

    setTimeout(() => {
      this.isLoading = false;
      console.log('Login submitted:', { email: this.email, rememberMe: this.rememberMe });
    }, 2000);
  }
}
